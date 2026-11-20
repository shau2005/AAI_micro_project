from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from backend.app import agents, gemini
from backend.app.models import Chunk, ContractMeta


def chunk(text, cid="test-contract", index=1):
    return Chunk(chunk_id=f"{cid}_C{index:04}", contract_id=cid,
                 page_start=1, page_end=1, text=text)


def graph_result():
    proof = [{"page": 1, "quote": "Donor shall transfer Property to Donee."}]
    return {"entities": [
        {"name": "Donor", "kind": "party", "evidence": proof},
        {"name": "Donee", "kind": "party", "evidence": proof}],
        "relationships": [
            {"source": "Donor", "target": "Donee", "relation": "TRANSFERS_TO", "evidence": proof},
            {"source": "Unknown", "target": "Donee", "relation": "OWES", "evidence": proof}]}


def test_graph_keeps_grounded_links_when_last_relation_has_missing_endpoint(monkeypatch):
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: graph_result())
    c = chunk("Donor shall transfer Property to Donee.")
    graph = agents.build_graph([c], "gemini-test")
    assert graph["extraction"]["method"] == "whole-contract-model-evidence-checked"
    assert graph["extraction"]["input_chars"] > len(c.text)
    assert len(graph["nodes"]) == 2
    assert len(graph["edges"]) == 1
    assert graph["edges"][0]["relation"] == "TRANSFERS_TO"


@pytest.mark.parametrize("bad_result", [None, {"entities": None, "relationships": []},
    {"entities": [{"name": "Invented", "kind": "party", "evidence": [{"page": 1, "quote": "Invented"}]}], "relationships": []}])
def test_unusable_model_graph_uses_fallback(monkeypatch, bad_result):
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: bad_result)
    graph = agents.build_graph([chunk("Donor shall transfer Property to Donee.")], "gemini-test")
    assert graph["extraction"]["method"] == "local-fallback"
    assert graph["extraction"]["warning"]


def test_malformed_graph_items_are_ignored(monkeypatch):
    result = graph_result()
    result["entities"].insert(0, None)
    result["entities"][1]["evidence"].insert(0, None)
    result["relationships"].insert(0, "invalid")
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: result)
    graph = agents.build_graph([chunk("Donor shall transfer Property to Donee.")], "gemini-test")
    assert len(graph["edges"]) == 1
    assert graph["extraction"]["method"] == "whole-contract-model-evidence-checked"


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


def test_graph_schema_constrains_entity_types_to_supported_types(monkeypatch):
    def generate(prompt, schema, *args, **kwargs):
        enum = schema["properties"]["entities"]["items"]["properties"]["kind"]["enum"]
        assert "party" in enum and "term" in enum
        assert "Individual" not in enum and "Defined Term" not in enum
        return graph_result()
    monkeypatch.setattr(gemini, "generate", generate)
    graph = agents.build_graph([chunk("Donor shall transfer Property to Donee.")], "gemini-test")
    assert graph["extraction"]["method"] == "whole-contract-model-evidence-checked"


def test_graph_retries_ungrounded_output_before_fallback(monkeypatch):
    responses = iter([{"entities": [], "relationships": []}, graph_result()])
    monkeypatch.setattr(agents.settings, "max_retries", 1)
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: next(responses))
    graph = agents.build_graph([chunk("Donor shall transfer Property to Donee.")], "gemini-test")
    assert graph["extraction"]["method"] == "whole-contract-model-evidence-checked"
    assert len(graph["edges"]) == 1


def test_graph_without_grounded_relationships_is_not_reported_as_success(monkeypatch):
    result = graph_result()
    result["relationships"] = []
    monkeypatch.setattr(gemini, "generate", lambda *a, **k: result)
    graph = agents.build_graph([chunk("Donor shall transfer Property to Donee.")], "gemini-test")
    assert graph["extraction"]["method"] == "local-fallback"
