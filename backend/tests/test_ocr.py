"""OCR: scanned pages are read with Tesseract; digital pages never are."""
from pathlib import Path

import fitz
import pytest

from backend.app import ingestion, ocr
from backend.app.agents import document_quality
from backend.app.ingestion import extract_and_chunk, read_pages
from backend.app.metadata import extract_metadata

SAMPLES = Path(__file__).resolve().parents[2] / "testing contracts"


def scanned_copy(name, dpi=200):
    """Turn a digital sample into an image-only PDF, like a phone scan of the paper deed."""
    source = fitz.open(SAMPLES / f"{name}.pdf")
    scanned = fitz.open()
    for page in source:
        pixmap = page.get_pixmap(dpi=dpi, colorspace=fitz.csGRAY)
        new_page = scanned.new_page(width=page.rect.width, height=page.rect.height)
        new_page.insert_image(new_page.rect, pixmap=pixmap)
    return scanned.tobytes()


def test_scanned_copy_has_no_digital_text():
    doc = fitz.open(stream=scanned_copy("sample_leave_and_licence"), filetype="pdf")
    assert all(not page.get_text("text").strip() for page in doc)


def test_needs_ocr_only_for_nearly_empty_pages():
    assert ocr.needs_ocr("")
    assert ocr.needs_ocr("  Page 1 \n ")
    assert not ocr.needs_ocr("This Agreement is made at Pune on this 18th day of October 2026")


def test_digital_pdf_never_calls_ocr(monkeypatch):
    def fail(page):
        raise AssertionError("OCR must not run on a digital page")
    monkeypatch.setattr(ocr, "ocr_page", fail)
    report = {}
    _, chunks = extract_and_chunk((SAMPLES / "sample_sale_deed.pdf").read_bytes(), "digital", ocr_report=report)
    assert chunks and report["ocr_pages"] == []
    assert all(chunk.extraction == "text" for chunk in chunks)


def test_scanned_pages_are_read_with_ocr_and_marked(monkeypatch):
    calls = []
    def fake_ocr(page):
        calls.append(page.number)
        return {"text": f"LEAVE AND LICENCE AGREEMENT\n\nPage {page.number + 1}: The monthly licence fee is Rs. 28,000/-.",
                "confidence": 91.5, "word_count": 12, "language": "eng"}
    monkeypatch.setattr(ocr, "ocr_page", fake_ocr)
    report = {}
    pages, chunks = extract_and_chunk(scanned_copy("sample_leave_and_licence"), "scan", ocr_report=report)
    assert pages == 2 and calls == [0, 1]
    assert report["ocr_pages"] == [1, 2] and report["ocr_confidence"] == {"1": 91.5, "2": 91.5}
    assert chunks and all(chunk.extraction == "ocr" for chunk in chunks)
    quality = document_quality(chunks)
    assert quality["ocr_pages"] == [1, 2]
    assert any("read with OCR" in warning for warning in quality["warnings"])


def test_rechunking_reuses_pages_without_repeating_ocr(monkeypatch):
    calls = []
    monkeypatch.setattr(ocr, "ocr_page", lambda page: calls.append(1) or {
        "text": "The Licensee shall pay Rs. 28,000/- per month to the Licensor. " * 20,
        "confidence": 90.0, "word_count": 200, "language": "eng"})
    pdf = scanned_copy("sample_gift_deed")
    pages = read_pages(fitz.open(stream=pdf, filetype="pdf"), {})
    first = len(calls)
    extract_and_chunk(pdf, "scan", 600, 80, pages=pages)
    extract_and_chunk(pdf, "scan", 900, 120, pages=pages)
    assert len(calls) == first


def test_missing_tesseract_is_reported_not_crashed(monkeypatch):
    def unavailable(page):
        raise ocr.OCRUnavailable("Tesseract OCR engine was not found. " + ocr.INSTALL_HINT)
    monkeypatch.setattr(ocr, "ocr_page", unavailable)
    report = {}
    _, chunks = extract_and_chunk(scanned_copy("sample_gift_deed"), "scan", ocr_report=report)
    assert chunks == []
    assert report["ocr_unavailable_pages"] == [1, 2] and "winget install" in report["ocr_error"]


def test_upload_of_scanned_pdf_without_ocr_explains_the_problem(monkeypatch, tmp_path):
    from fastapi.testclient import TestClient
    from backend.app import main, agents
    from backend.app.storage import LocalStore
    monkeypatch.setattr(main.settings, "data_dir", tmp_path)
    storage = LocalStore()
    monkeypatch.setattr(main, "store", storage)
    monkeypatch.setattr(agents, "store", storage)
    monkeypatch.setattr(ocr, "ocr_page", lambda page: (_ for _ in ()).throw(ocr.OCRUnavailable("Tesseract OCR engine was not found.")))
    client = TestClient(main.app)
    response = client.post("/api/contracts", files={"file": ("scan.pdf", scanned_copy("sample_gift_deed"), "application/pdf")},
                           data={"model": "local"}, headers={"x-workspace-id": "ocr"})
    contract = client.get(f"/api/contracts/{response.json()['contract_id']}", headers={"x-workspace-id": "ocr"}).json()
    assert contract["processing_status"] == "failed"
    assert "scanned" in contract["indexing_error"] and "OCR is unavailable" in contract["indexing_error"]


live = pytest.mark.skipif(not ocr.tesseract_status()["available"], reason="Tesseract OCR engine is not installed")


@live
def test_live_tesseract_reads_scanned_contract_into_correct_metadata():
    report = {}
    _, chunks = extract_and_chunk(scanned_copy("sample_leave_and_licence", dpi=200), "live-ocr", ocr_report=report)
    assert report["ocr_pages"] == [1, 2]
    assert min(report["ocr_confidence"].values()) > 70
    text = " ".join(chunk.text for chunk in chunks)
    assert "LEAVE AND LICENCE AGREEMENT" in text and "28,000" in text
    metadata = extract_metadata(chunks, classification={"document_type": "leave and licence agreement"})
    roles = {party["role"]: party["name"] for party in metadata["parties"]}
    assert roles.get("Licensor") == "Mrs. Sunita Mahesh Joshi"
    assert roles.get("Licensee") == "Mr. Arjun Vikram Rao"
    amounts = {item["label"]: item["value"] for item in metadata["amounts"]}
    assert amounts.get("Rent / licence fee") == 28000 and amounts.get("Security deposit") == 56000


@live
@pytest.mark.parametrize("name,kind", [("sample_sale_deed", "sale deed"), ("sample_leave_and_licence", "leave and licence agreement"),
                                       ("sample_gift_deed", "gift deed")])
def test_live_ocr_metadata_matches_digital_text(name, kind):
    def facts(pdf):
        _, chunks = extract_and_chunk(pdf, "compare")
        metadata = extract_metadata(chunks, classification={"document_type": kind})
        return (sorted((p["role"], p["name"]) for p in metadata["parties"] if p["role"] != "Mentioned person"),
                sorted((a["label"], a["value"]) for a in metadata["amounts"]),
                sorted((d["label"], d["value"]) for d in metadata["dates"]),
                metadata["required"]["missing"])
    assert facts(scanned_copy(name)) == facts((SAMPLES / f"{name}.pdf").read_bytes())
