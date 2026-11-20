# AAI_micro_project — Legal Contract Review Agent

Evidence-led contract review with FastAPI, React, local embeddings, lexical/vector retrieval, and supervised review agents.

Based on [moneet9/LEGAL-CONTRACT-REVIEW-AGENT-](https://github.com/moneet9/LEGAL-CONTRACT-REVIEW-AGENT-).

## Current review workflow

**Graph RAG is restored.** Graph extraction, evidence validation and relationship-based retrieval supplement BM25/vector passages and the extracted document metadata. The Relationship graph tab shows evidence-backed entities and links. The restored implementation uses direct evidence-linked relationships rather than general multi-hop graph traversal.

The earlier working implementation is preserved at Git tag `graphrag-ready-2026-11-19`. See [the restoration guide](docs/GRAPH_RAG_RESTORE.md) for a selective, verified restoration patch and implementation steps.

## Run locally

Use Python 3.12 and a supported Node.js installation.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
cp .env.example .env
python -m uvicorn backend.app.main:app --reload
```

In a second terminal:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite, normally `http://localhost:5173`.

Keep API keys in the ignored `.env` file. Gemini requests have a configurable timeout; if model review is unavailable, analysis continues with a labelled local rule review. Chat uses the default model when none is specified and returns source excerpts when generation is unavailable. Choose “Local source excerpts” to skip model generation explicitly. Tavily provides optional official-source research.

On Windows, use the existing `start.cmd` / `start.ps1` setup scripts and `stop.cmd` / `stop.ps1` stop scripts.

### OCR for scanned PDFs

Scanned (image-only) pages are read with the **Tesseract** OCR engine through `pytesseract`. Install the engine once:

- Windows: `winget install --id UB-Mannheim.TesseractOCR`
- Ubuntu/Debian: `sudo apt install tesseract-ocr`

The app finds Tesseract on `PATH` or in the standard Windows install folder; otherwise set `TESSERACT_CMD` in `.env`. Only pages with almost no digital text (`OCR_MIN_CHARS`) are sent to OCR, rendered at `OCR_DPI`. Add Hindi or Marathi with `OCR_LANGUAGES=eng+hin+mar` after installing those Tesseract language packs. `GET /api/ocr/status` reports whether OCR is ready. If a scanned PDF is uploaded without Tesseract, indexing fails with a message explaining how to enable OCR.

## Review workflow

1. Extract PDF text (Tesseract OCR for scanned pages), optimise chunks, and build lexical/vector indexes.
2. Classify the document.
3. **MetadataAgent** extracts parties and roles, dates, amounts, durations, property details and the explicit relationships between them (for example *Vendee pays Sale consideration to Vendor*), and checks the details required for that document type. Local rules always run; a selected model adds values, but only values whose quote is found in the contract are kept.
4. Obtain optional official-source research.
5. Scan the indexed evidence for both party perspectives, using the metadata to identify the parties.
6. Build an evidence-backed relationship graph alongside structure, signature, intent, deadline, and obligation checks; validate the graph and review its relationships.
7. Check coverage, document quality (including which pages came from OCR), sensitive-data signals, and applicable deed templates.
8. Remove unsupported/duplicate findings, cross-check evidence, and calculate explainable scores.
9. Save reports, metadata, citations, checks, and activity for the interface.

`MasterAgent` coordinates stage order, parallel work, bounded retries, progress, and audit logging. Chat uses a separate passage-retrieval and answer-generation flow; the saved metadata is added to chat prompts with its source chunk IDs, so answers about parties, dates and amounts stay cited.

## Interface

- **Review report:** party perspectives, scores, findings, and source quotations.
- **Contract chat:** questions answered from selected contract passages and extracted metadata.
- **Relationship graph:** explore evidence-backed entities and relationships, pan/zoom, and open source passages. Chat retrieves graph facts connected to its selected evidence.
- **Key facts:** MetadataAgent output — parties, amounts, dates, durations, property, relationships and required-detail checks, each with its page.
- **Evidence & checks:** citations, document quality, deadlines, obligations, signatures, and templates.
- **Legal research:** classification and linked official-source search results.
- **Agent activity:** stage results, retries, and fallback information.

The bundled PDFs in `testing contracts/` are fictional software-test specimens. Text checks cannot authenticate signatures. Review scores and keyword checklists do not establish legal validity.

## Tests

```bash
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

API diagnostics include `/api/health`, `/api/ocr/status`, `/api/agents/telemetry`, `/api/contracts/{id}/review`, `/api/contracts/{id}/metadata`, and `/api/contracts/{id}/artifacts`. Contract-specific requests require the owning `X-Workspace-ID` header.

## Current limitations

1. No dedicated systematic contradiction detection across clauses.
2. No dedicated verification of referenced clauses and attachments.
3. OCR accuracy depends on scan quality; OCR pages are flagged so names, dates and amounts can be checked against the original.
4. Graph retrieval uses direct evidence-linked relationships and does not implement general multi-hop traversal.

Historical architecture notes in `PROJECT_DETAILS.md` describe the earlier version; this README describes the current restored workflow.

Each document has its own saved chat history. Open a document in the library to ask questions about that document only. Switching documents preserves drafts and keeps delayed replies with their original conversation. Earlier shared workspace conversations remain saved separately.

Use the trash icon beside a contract to delete its PDF, extracted data, search indexes, review, and document chat after confirmation. Deletion is unavailable during indexing or review. Uploading the same PDF afterward starts a fresh review.

Finding details explain the concern in everyday language, why its priority was assigned, an illustrative example when available, relevant legal terms, and the exact source wording. New model reviews request an individual priority rationale; older reports explicitly identify when that rationale was not saved. Local-rule priorities are labelled as checklist presets.

After restoring Graph RAG, open **Review report** and choose **Re-run contract review** for documents reviewed without a graph. Viewing **Relationship graph** only reads saved results; it does not start a hidden model request.
