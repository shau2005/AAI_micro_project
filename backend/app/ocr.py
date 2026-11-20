"""OCR for scanned PDF pages using the Tesseract engine (via pytesseract).

A page is sent to OCR only when PyMuPDF finds (almost) no digital text on it,
so normal PDFs are never slowed down. The page is rendered to a grayscale
image at `OCR_DPI` and read by Tesseract in the configured languages.
"""
from __future__ import annotations

import os
import shutil
from functools import lru_cache
from pathlib import Path
from typing import Any

from .config import settings

WINDOWS_PATHS = [
    Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tesseract-OCR" / "tesseract.exe",
    Path(os.environ.get("ProgramFiles(x86)", r"C:\Program Files (x86)")) / "Tesseract-OCR" / "tesseract.exe",
    Path(os.environ.get("LOCALAPPDATA", "")) / "Programs" / "Tesseract-OCR" / "tesseract.exe",
]
INSTALL_HINT = ("Install Tesseract OCR (Windows: `winget install --id UB-Mannheim.TesseractOCR`; "
                "Linux: `apt install tesseract-ocr`) or set TESSERACT_CMD in .env to its path.")


class OCRUnavailable(RuntimeError):
    """Raised when a scanned page needs OCR but Tesseract cannot be used."""


def _tesseract_path() -> str | None:
    if settings.tesseract_cmd:
        return settings.tesseract_cmd if Path(settings.tesseract_cmd).is_file() else None
    found = shutil.which("tesseract")
    if found:
        return found
    return next((str(path) for path in WINDOWS_PATHS if path.is_file()), None)


@lru_cache(maxsize=1)
def tesseract_status() -> dict[str, Any]:
    """Report whether OCR can run, without raising."""
    if not settings.enable_ocr:
        return {"available": False, "reason": "OCR is disabled (ENABLE_OCR=false)."}
    try:
        import pytesseract
    except ImportError:
        return {"available": False, "reason": "The pytesseract package is not installed (pip install -r backend/requirements.txt)."}
    path = _tesseract_path()
    if not path:
        return {"available": False, "reason": "Tesseract OCR engine was not found. " + INSTALL_HINT}
    pytesseract.pytesseract.tesseract_cmd = path
    try:
        version = str(pytesseract.get_tesseract_version())
        installed = set(pytesseract.get_languages(config=""))
    except Exception as error:  # noqa: BLE001 - report any engine problem as unavailable
        return {"available": False, "reason": f"Tesseract could not be started ({type(error).__name__}). " + INSTALL_HINT}
    wanted = [lang for lang in settings.ocr_languages.split("+") if lang]
    languages = [lang for lang in wanted if lang in installed] or (["eng"] if "eng" in installed else sorted(installed)[:1])
    return {"available": True, "path": path, "version": version, "languages": languages,
            "missing_languages": [lang for lang in wanted if lang not in installed]}


def needs_ocr(text: str) -> bool:
    """A page with fewer than OCR_MIN_CHARS of real characters is treated as scanned."""
    return len("".join(text.split())) < settings.ocr_min_chars


def ocr_page(page) -> dict[str, Any]:
    """Read one PyMuPDF page with Tesseract and return its text and mean word confidence."""
    status = tesseract_status()
    if not status["available"]:
        raise OCRUnavailable(status["reason"])
    import pytesseract
    from PIL import Image
    import fitz

    pixmap = page.get_pixmap(dpi=settings.ocr_dpi, colorspace=fitz.csGRAY, alpha=False)
    image = Image.frombytes("L", (pixmap.width, pixmap.height), pixmap.samples)
    language = "+".join(status["languages"])
    data = pytesseract.image_to_data(image, lang=language, config="--oem 3 --psm 3",
                                     output_type=pytesseract.Output.DICT)
    lines: dict[tuple[int, int, int], list[str]] = {}
    confidences = []
    for index, word in enumerate(data["text"]):
        word = word.strip()
        confidence = float(data["conf"][index])
        if not word or confidence < 0:
            continue
        key = (data["block_num"][index], data["par_num"][index], data["line_num"][index])
        lines.setdefault(key, []).append(word)
        confidences.append(confidence)
    paragraphs: list[str] = []
    previous_block = None
    for (block, paragraph, _line), words in sorted(lines.items()):
        if previous_block is not None and (block, paragraph) != previous_block:
            paragraphs.append("")  # blank line keeps paragraph breaks for clause detection
        paragraphs.append(" ".join(words))
        previous_block = (block, paragraph)
    text = "\n".join(paragraphs).strip()
    return {"text": text, "confidence": round(sum(confidences) / len(confidences), 1) if confidences else 0.0,
            "word_count": len(confidences), "language": language}
