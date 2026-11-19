from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app import agents, gemini
from backend.app.models import Chunk, ContractMeta


def chunk(text, cid="test-contract", index=1):
    return Chunk(chunk_id=f"{cid}_C{index:04}", contract_id=cid,
                 page_start=1, page_end=1, text=text)










def test_gemini_retries_transient_generation_failure(monkeypatch):
    attempts = []
    def generate_content(**kwargs):
        attempts.append(kwargs)
        if len(attempts) == 1:
            raise RuntimeError("Temporary provider failure")
        return SimpleNamespace(text='{"ok":true}')
    client = gemini.GeminiClient.__new__(gemini.GeminiClient)
    client.client = SimpleNamespace(models=SimpleNamespace(generate_content=generate_content))
    monkeypatch.setattr(gemini.settings, "max_retries", 1)
    monkeypatch.setattr(gemini.time, "sleep", lambda delay: None)
    assert client.generate_structured("test", {"type": "object"}) == {"ok": True}
    assert len(attempts) == 2


def test_written_dates_and_existing_date_formats():
    dates = ["01 November 2026", "15th October 2026", "09 Jun 2005",
             "November 1, 2026", "2026-11-01", "01/11/2026"]
    result = agents.inspect_deadlines([chunk("; ".join(dates))])
    assert {d["value"] for d in result["dates"]} == set(dates)


def test_explicit_gift_deed_resolves_unclear_model_classification(monkeypatch):
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: {
        "document_type": "other/unclear", "confidence": "high", "jurisdiction": "Maharashtra, India",
        "alternatives": [], "reasoning": "Gift deed outside listed types.", "quote": "GIFT DEED"})
    result = agents.classify_contract([chunk("GIFT DEED. Donor gives property to Donee.")], "gemini-test")
    assert result["document_type"] == "gift deed"
    assert result["jurisdiction"] == "Maharashtra, India"
    assert result["evidence"]["quote"] == "GIFT DEED"


@pytest.mark.parametrize("role", ["Donor", "Donee", "Licensor", "Licensee", "Vendee"])
def test_property_contract_subject_roles(role):
    result = agents.extract_obligations([chunk(f"The {role} shall cooperate with the Vendor.")])
    assert result["obligations"][0]["actor"] == role
    assert result["unassigned_count"] == 0


def test_recipient_does_not_become_responsible_actor():
    result = agents.extract_obligations([chunk("Payment shall be made to the Licensor.")])
    assert result["obligations"][0]["actor"] is None


@pytest.mark.parametrize("workspace", [False, True])
def test_chat_citation_contains_facts_after_old_preview_limit(monkeypatch, tmp_path, workspace):
    from backend.app import main, retrieval
    from backend.app.storage import LocalStore

    monkeypatch.setattr(main.settings, "data_dir", tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, "store", storage)
    c = chunk("Background details. " * 30 + "Monthly fee: Rs. 28,000. Deposit: Rs. 56,000.")
    meta = ContractMeta(contract_id=c.contract_id, original_filename="sample.pdf", sha256="test",
                        upload_time=datetime.now(timezone.utc), processing_status="ready")
    storage.save_contract(meta, b"%PDF test")
    storage.save_chunks(c.contract_id, [c])
    monkeypatch.setattr(retrieval, "HybridRetriever", lambda *a, **k: SimpleNamespace(search=lambda *a, **k: [c]))
    monkeypatch.setattr(main, "generate", lambda *a, **k: {
        "answer": "The fee is Rs. 28,000 and deposit Rs. 56,000.", "cited_chunk_ids": [c.chunk_id]})
    request = {"message": "What are the fee and deposit?", "model": "gemini-test"}
    if workspace:
        request["contract_ids"] = [c.contract_id]
    url = "/api/workspace/chat" if workspace else f"/api/contracts/{c.contract_id}/chat"
    response = TestClient(main.app).post(url, json=request)
    assert response.status_code == 200
    citation = response.json()["citations"][0]
    assert citation["quote"] == c.text
    assert "28,000" in citation["quote"] and "56,000" in citation["quote"]


def test_passive_duty_has_explicit_actor():
    result = agents.extract_obligations([chunk("Utilities shall be paid by the Licensee.")])
    assert result["obligations"][0]["actor"] == "Licensee"


def test_multiple_duties_keep_their_respective_subjects():
    result = agents.extract_obligations([chunk("The Licensor shall repair the roof; the Licensee shall pay utilities.")])
    assert [d["actor"] for d in result["obligations"]] == ["Licensor", "Licensee"]


def test_free_will_is_not_an_obligation():
    assert agents.extract_obligations([chunk("The parties sign of their own free will without coercion.")])["obligations"] == []
