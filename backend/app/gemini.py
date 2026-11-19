import json, time
import httpx
from requests.exceptions import Timeout as RequestsTimeout
from .config import settings
class ModelGenerationError(RuntimeError):
    # The model client owns retries; do not multiply them in the orchestrator.
    retryable = False

class ModelTimeoutError(ModelGenerationError):
    pass

class GeminiClient:
    def __init__(self):
        self.available=bool(settings.gemini_api_key); self.client=None
        if self.available:
            from google import genai
            self.client=genai.Client(api_key=settings.gemini_api_key, http_options={"timeout": int(settings.gemini_timeout_seconds * 1000)})
    def generate_structured(self,prompt,schema,model=None,temperature=None):
        if not self.client: return None
        for attempt in range(settings.max_retries+1):
            try:
                config={"response_mime_type":"application/json","response_schema":schema}
                if temperature is not None: config["temperature"]=temperature
                response=self.client.models.generate_content(model=model or settings.gemini_model,contents=prompt,config=config)
                return json.loads(response.text)
            except (RequestsTimeout, httpx.TimeoutException) as error:
                raise ModelTimeoutError(
                    f"Gemini did not respond within {settings.gemini_timeout_seconds:g} seconds. "
                    "Retry the review or choose another review model."
                ) from error
            except Exception as error:
                code = getattr(error, "code", None)
                if attempt>=settings.max_retries or code in {400, 401, 403, 404}:
                    status = f"HTTP {code}" if code else type(error).__name__
                    advice = "The selected model is unavailable. Choose another review model." if code == 404 else "Check API key access." if code in {401, 403} else "Retry the review or choose another review model."
                    raise ModelGenerationError(
                        f"Gemini generation failed ({status}) after {attempt+1} attempt(s). {advice}"
                    ) from error
                time.sleep(2**attempt)

def available_models() -> list[dict[str, str]]:
    models = []
    if settings.gemini_api_key:
        try:
            from google import genai
            client = genai.Client(api_key=settings.gemini_api_key, http_options={"timeout": 10000})
            for model in client.models.list():
                name = str(getattr(model, "name", "")).removeprefix("models/")
                actions = list(getattr(model, "supported_actions", []) or [])
                unsupported = ("tts", "image", "transcribe", "lyria", "robotics", "deep-research", "nano-banana")
                if name and not any(marker in name for marker in unsupported) and (not actions or "generateContent" in actions):
                    models.append({"id": name, "name": name, "provider": "Google"})
        except Exception:
            # Model-catalog access can fail even when the configured model is usable
            # (for example, restricted outbound networking). Keep the configured
            # model selectable and let generation report any real auth/API failure.
            pass
        configured = settings.gemini_model.strip()
        if configured and not any(item["id"] == configured for item in models):
            models.append({"id": configured, "name": f"{configured} (configured)", "provider": "Google"})
    try:
        response = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=1.5)
        response.raise_for_status()
        models.extend({"id": item["name"], "name": item["name"], "provider": "Ollama"} for item in response.json().get("models", []))
    except (httpx.HTTPError, ValueError, KeyError):
        pass
    unique = {item["id"]: item for item in models}
    return list(unique.values())


def default_model(models: list[dict[str, str]]) -> str | None:
    ids = [item["id"] for item in models]
    if settings.gemini_model in ids:
        return settings.gemini_model
    google = next((item["id"] for item in models if item["provider"] == "Google"), None)
    return google or (ids[0] if ids else None)


def generate(prompt: str, schema: dict, model: str | None = None, temperature: float | None = None):
    if not model:
        return None
    selected = model
    if selected.startswith(("gemini", "gemma")):
        return GeminiClient().generate_structured(prompt, schema, selected, temperature)
    try:
        response = httpx.post(
            f"{settings.ollama_base_url}/api/generate",
            json={"model": selected, "prompt": prompt, "format": "json", "stream": False, **({"options": {"temperature": temperature}} if temperature is not None else {})},
            timeout=120,
        )
        response.raise_for_status()
        return json.loads(response.json()["response"])
    except (httpx.HTTPError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise ModelGenerationError(f"Ollama model API failed for '{selected}': {error}") from error
