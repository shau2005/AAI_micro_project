# Graph RAG restoration / implementation guide

## Saved state

- The active project is a **graph-free review baseline**.
- The previous working implementation is preserved at local Git tag `graphrag-ready-2026-11-19`, commit `8c18e1f`.
- It includes graph extraction, evidence validation, graph-assisted retrieval, a graph UI, and graph-specific tests.
- `docs/restore-graphrag.patch` reintroduces those integrations selectively and preserves reviews saved by the baseline.
- This preparation is for the requested follow-up on **20 November 2026**. Nothing automatically runs tomorrow. Ask to restore or implement Graph RAG when ready.

## Current baseline

Upload -> extract/chunk -> embeddings and lexical/vector indexes -> supervised review -> both party reports.

Chat question -> HybridRetriever -> source passages -> model answer or local excerpts -> citations.

There are no active GraphBuilder, GraphValidator, GraphReviewerAgent, or GraphRetriever agents, no graph prompt context, no `/graph` API route, and no Relationship graph tab. Document checks are served through `/api/contracts/{id}/artifacts`.

Previously saved graph files are retained as historical local data but are not used or returned by the baseline. Normal reports, scores and citations remain readable.

## Quick restoration using the prepared module

From the project root, first save any new work. Inspect the patch before applying it. If its check fails, resolve the affected hunks; do not overwrite whole files with the checkpoint, because that could erase later changes.

```bash
git status --short
git apply --check docs/restore-graphrag.patch
git apply docs/restore-graphrag.patch
python -m pytest backend/tests -q
cd frontend
npm test
npm run build
```

The patch restores graph-specific tests and removes tests that explicitly require graph absence. It restores README/workflow documentation too. Storage compatibility in the patch reads newer `.review.json` artifacts before older `.graph.json` data.

After restoring, refresh the app and re-review the chosen sample to build a current graph. A graph picture alone is not Graph RAG: verify that chat actually receives evidence-backed relationship facts.

## Implementation steps if coding it manually

1. **GraphBuilder:** extract named parties, roles, obligations, amounts and dates from indexed passages. Every entity/link needs source-page evidence. Keep a deterministic local fallback for unavailable Gemini.
2. **GraphValidator:** discard unknown endpoints, self-links, duplicate links and unsupported quotations.
3. **Orchestrator:** add GraphBuilder to the independent checks, then validate/review its graph before saving review artifacts.
4. **GraphRetriever:** connect retrieved chunk IDs to relationship evidence and return the relevant facts. The preserved implementation handles direct evidence-linked relationships; it does not implement general multi-hop traversal.
5. **Chat:** add graph facts alongside retrieved text in both single-contract and workspace prompts. Keep source citations and workspace checks.
6. **Interface:** restore the Relationship graph tab, node/edge types, layout controls, source links and graph-agent activity.

## Demonstration checklist

- Baseline: only passage retrieval is active.
- After implementation: graph contains meaningful entities and relationships with source evidence.
- A chat question produces graph facts connected to the retrieved source passages.
- The answer still cites real contract chunks.
- Invalid graph output or provider failure uses the local fallback.
- Another workspace cannot access the document or graph.

Do not claim that graph traversal was used merely because an answer is correct; inspect retrieval traces and agent activity. Ordinary passage retrieval may also find all necessary evidence.

## Verification performed before saving

- Graph-free baseline: 34 backend tests and 11 frontend tests passed; TypeScript and Vite production build passed.
- Restoration: patch applied to an isolated scratch copy; all 37 original backend tests and TypeScript compilation passed.
- Running baseline API: existing scores preserved, document artifacts readable, graph fields excluded, and `/graph` returns 404.
