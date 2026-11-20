"""MetadataAgent: grounded parties, dates, amounts, relationships and required details."""
from pathlib import Path

import pytest

from backend.app import gemini
from backend.app.agents import AGENT_CONTRIBUTIONS
from backend.app.ingestion import extract_and_chunk
from backend.app.metadata import extract_metadata, metadata_chunk_ids, metadata_context
from backend.app.models import Chunk

SAMPLES = Path(__file__).resolve().parents[2] / "testing contracts"


def chunks_for(name):
    _, chunks = extract_and_chunk((SAMPLES / f"{name}.pdf").read_bytes(), "meta-test")
    return chunks


def find(items, label):
    return [item for item in items if item["label"] == label]


def roles(metadata):
    return {party["role"]: party["name"] for party in metadata["parties"] if party["role"] != "Mentioned person"}


def relation_set(metadata):
    return {(r["source"], r["relation"], r["target"]) for r in metadata["relationships"]}


@pytest.fixture(scope="module")
def licence():
    return extract_metadata(chunks_for("sample_leave_and_licence"), classification={"document_type": "leave and licence agreement"})


@pytest.fixture(scope="module")
def sale():
    return extract_metadata(chunks_for("sample_sale_deed"), classification={"document_type": "sale deed"})


@pytest.fixture(scope="module")
def gift():
    return extract_metadata(chunks_for("sample_gift_deed"), classification={"document_type": "gift deed"})


def test_metadata_agent_is_registered():
    assert "MetadataAgent" in AGENT_CONTRIBUTIONS


def test_parties_and_roles_are_extracted(licence, sale, gift):
    assert roles(licence)["Licensor"] == "Mrs. Sunita Mahesh Joshi"
    assert roles(licence)["Licensee"] == "Mr. Arjun Vikram Rao"
    assert roles(sale)["Vendor"] == "Mr. Rajesh Mohan Deshmukh"
    assert roles(sale)["Vendee"] == "Mrs. Priya Anil Kulkarni"
    assert roles(gift)["Donor"] == "Mrs. Meena Prakash Patil"
    assert roles(gift)["Donee"] == "Mr. Rohan Prakash Patil"
    licensor = next(p for p in licence["parties"] if p["role"] == "Licensor")
    assert licensor["side"] == "giver" and licensor["relation"] == "W/o Mahesh Joshi" and licensor["age"] == 47
    assert "Lake View" in licensor["address"]
    # Identity numbers are masked, never stored in full.
    assert all("CDEPJ2345G" not in identifier for identifier in licensor["identifiers"])


def test_witnesses_are_identified(licence, sale):
    assert sum(p["role"] == "Witness" for p in licence["parties"]) == 2
    assert sum(p["role"] == "Witness" for p in sale["parties"]) == 2


def test_parent_names_are_not_separate_parties(licence):
    names = {party["name"] for party in licence["parties"]}
    assert not any(name.endswith("Mahesh Joshi") and name != "Mrs. Sunita Mahesh Joshi" for name in names)


def test_dates_are_labelled_and_normalised(licence, sale):
    assert find(licence["dates"], "Execution date")[0]["value"] == "2026-10-18"
    assert find(licence["dates"], "Start date")[0]["value"] == "2026-11-01"
    assert find(licence["dates"], "End date")[0]["value"] == "2027-09-30"
    assert find(sale["dates"], "Execution date")[0]["value"] == "2026-10-20"


def test_amounts_are_labelled_with_numeric_values(licence, sale):
    rent = find(licence["amounts"], "Rent / licence fee")[0]
    assert rent["value"] == 28000 and rent["frequency"] == "monthly"
    assert find(licence["amounts"], "Security deposit")[0]["value"] == 56000
    assert find(sale["amounts"], "Sale consideration")[0]["value"] == 8250000  # Indian grouping 82,50,000
    assert find(sale["amounts"], "Stamp duty")[0]["value"] == 495000


def test_durations_ignore_ages_and_label_terms(licence):
    durations = {(item["label"], item["value"], item["unit"]) for item in licence["durations"]}
    assert ("Agreement term", 11, "months") in durations
    assert ("Lock-in period", 6, "months") in durations
    assert ("Notice period", 60, "days") in durations
    assert not any(item["value"] in {47, 29} and item["unit"] == "years" for item in licence["durations"])


def test_property_excludes_party_homes_and_boundaries(licence, sale):
    assert [item["value"] for item in licence["property"]["items"]] == ["Flat No. 204, Orchid Heights, Baner Road, Pune 411045"]
    values = " ".join(item["value"] for item in sale["property"]["items"])
    assert "Flat No. 502" in values and "Flat No. 301" not in values and "Flat No. 501" not in values


def test_explicit_relationships_between_parties_amounts_and_property(licence, sale, gift):
    assert ("Licensee", "pays", "Security deposit: Rs. 56,000/-") in relation_set(licence)
    assert ("Rent / licence fee: Rs. 28,000/- (monthly)", "is paid to", "Licensor") in relation_set(licence)
    assert ("Vendee", "pays", "Sale consideration: Rs. 82,50,000/-") in relation_set(sale)
    assert ("Sale consideration: Rs. 82,50,000/-", "is paid to", "Vendor") in relation_set(sale)
    assert ("Vendor", "transfers property to", "Vendee") in relation_set(sale)
    assert ("Donor", "gifts property to", "Donee") in relation_set(gift)


def test_every_value_is_grounded_in_its_chunk(licence, sale):
    for metadata, name in ((licence, "sample_leave_and_licence"), (sale, "sample_sale_deed")):
        chunks = {chunk.chunk_id: chunk for chunk in chunks_for(name)}
        groups = [metadata["parties"], metadata["dates"], metadata["amounts"], metadata["durations"],
                  metadata["property"]["items"], metadata["relationships"]]
        for group in groups:
            for item in group:
                evidence = item["evidence"]
                chunk = chunks[evidence["chunk_id"]]
                assert " ".join(evidence["quote"].split()) in " ".join(chunk.text.split())
                assert chunk.page_start == evidence["page"]


def test_required_details_are_checked_per_document_type(licence, sale, gift):
    for metadata in (licence, sale, gift):
        assert metadata["required"]["missing"] == []
        assert metadata["required"]["present_count"] == metadata["required"]["required_count"]
    assert licence["required"]["document_family"] == "licence"
    assert sale["required"]["document_family"] == "sale"


def test_missing_required_details_are_reported_not_guessed():
    chunk = Chunk(chunk_id="m_C0001", contract_id="m", page_start=1, page_end=1,
                  text='LEAVE AND LICENCE AGREEMENT\nMrs. Asha Rao (hereinafter the "LICENSOR") grants a licence. The monthly rent is Rs. 15,000/-.')
    metadata = extract_metadata([chunk], classification={"document_type": "leave and licence agreement"})
    missing = metadata["required"]["missing"]
    assert "Licensee / tenant" in missing and "Security deposit" in missing and "Start date" in missing
    assert "Rent / licence fee" not in missing


def test_model_values_are_kept_only_when_grounded(monkeypatch):
    chunk = Chunk(chunk_id="g_C0001", contract_id="g", page_start=1, page_end=1,
                  text='Mrs. Asha Rao (hereinafter the "LICENSOR") and Mr. Vikas Jain (hereinafter the "LICENSEE"). '
                       'The licensee shall pay a monthly licence fee of Rs. 15,000/- to the Licensor.')
    model_output = {
        "parties": [{"name": "Mr. Imaginary Person", "role": "Guarantor", "page": 1, "quote": "Mr. Imaginary Person guarantees payment"}],
        "dates": [],
        "amounts": [{"label": "Brokerage", "value": "Rs. 99,000", "page": 1, "quote": "brokerage of Rs. 99,000 is payable"},
                    {"label": "Licence fee", "value": "15,000", "page": 1, "quote": "monthly licence fee of Rs. 15,000/- to the Licensor"}],
        "durations": [], "property": [],
        "relationships": [{"source": "Licensee", "relation": "pays licence fee to", "target": "Licensor", "page": 1,
                           "quote": "The licensee shall pay a monthly licence fee of Rs. 15,000/- to the Licensor"}]}
    monkeypatch.setattr(gemini, "generate", lambda *args, **kwargs: model_output)
    metadata = extract_metadata([chunk], model="gemini-test", classification={"document_type": "leave and licence"})
    assert metadata["method"] == "rules+model"
    assert "Mr. Imaginary Person" not in {party["name"] for party in metadata["parties"]}
    assert not any(item["text"] == "Rs. 99,000" for item in metadata["amounts"])
    assert ("Licensee", "pays licence fee to", "Licensor") in relation_set(metadata)


def test_model_failure_falls_back_to_rules(monkeypatch):
    def unavailable(*args, **kwargs):
        raise gemini.ModelGenerationError("model unavailable")
    monkeypatch.setattr(gemini, "generate", unavailable)
    metadata = extract_metadata(chunks_for("sample_leave_and_licence"), model="gemini-test",
                                classification={"document_type": "leave and licence agreement"})
    assert metadata["method"] == "rules"
    assert metadata["warnings"] and roles(metadata)["Licensee"] == "Mr. Arjun Vikram Rao"


def test_prompt_context_cites_pages_and_chunks(licence):
    plain = metadata_context(licence)
    cited = metadata_context(licence, with_chunk_ids=True)
    assert "Party: Mr. Arjun Vikram Rao = Licensee" in plain and "[p.1]" in plain
    assert "CHUNK_ID meta-test_C" in cited
    assert metadata_chunk_ids(licence) and all(chunk_id.startswith("meta-test_C") for chunk_id in metadata_chunk_ids(licence))
