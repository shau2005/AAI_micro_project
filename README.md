# AAI_micro_project — Legal Contract Review Agent

Evidence-led contract review with FastAPI, React, local embeddings, lexical/vector retrieval, and supervised review agents.

Based on [moneet9/LEGAL-CONTRACT-REVIEW-AGENT-](https://github.com/moneet9/LEGAL-CONTRACT-REVIEW-AGENT-).

## Current review baseline

**Graph RAG is not included in this baseline.** Graph building, graph validation, graph retrieval, and the relationship-graph UI have been removed. Chat retrieves contract passages through BM25 and vector search and returns citations. It does not use entity relationships or graph traversal.

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

Keep API keys in the ignored `.env` file. Gemini requests have a configurable timeout; if model review is unavailable, analysis continues with a labelled local rule review. Chat returns source excerpts when model generation is unavailable. Tavily provides optional official-source research.

On Windows, use the existing `start.cmd` / `start.ps1` setup scripts and `stop.cmd` / `stop.ps1` stop scripts.

## Review workflow

1. Extract PDF text, optimise chunks, and build lexical/vector indexes.
2. Classify the document and obtain optional official-source research.
3. Scan the indexed evidence for both party perspectives.
4. Run structure, signature, intent, deadline, and obligation checks in parallel.
5. Check coverage, document quality, sensitive-data signals, and applicable deed templates.
6. Remove unsupported/duplicate findings, cross-check evidence, and calculate explainable scores.
7. Save reports, citations, checks, and activity for the interface.

`MasterAgent` coordinates stage order, parallel work, bounded retries, progress, and audit logging. Chat uses a separate passage-retrieval and answer-generation flow.

## Interface

- **Review report:** party perspectives, scores, findings, and source quotations.
- **Contract chat:** questions answered from selected contract passages.
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

API diagnostics include `/api/health`, `/api/agents/telemetry`, `/api/contracts/{id}/review`, and `/api/contracts/{id}/artifacts`. Contract-specific requests require the owning `X-Workspace-ID` header.

## Current limitations

1. No dedicated systematic contradiction detection across clauses.
2. No dedicated verification of referenced clauses and attachments.
3. No OCR pipeline for image-only scanned PDFs.
4. No Graph RAG to retrieve information through entity relationships.

Historical architecture notes in `PROJECT_DETAILS.md` describe the earlier version; this README describes the active baseline.
