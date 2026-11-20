# Graph RAG — restored 20 November 2026

## Active status

Graph RAG is active in this checkout. The GraphBuilder, GraphValidator, GraphReviewerAgent and GraphRetriever integrations and Relationship graph tab are restored. MetadataAgent, OCR support, independent document chats, document deletion, and plain-language finding explanations remain integrated.

The graph-free state is preserved in Git commit `38378f3`. The earlier graph implementation is also saved at tag `graphrag-ready-2026-11-19`. `docs/restore-graphrag.patch` is the forward patch already applied to the graph-free state; do not apply it again to the restored checkout.

## Use it

1. Start the backend and frontend, and refresh the browser.
2. Open a document and choose **Review report → Re-run contract review** if it was reviewed without a graph. Uploading a new PDF also runs graph extraction.
3. Open **Relationship graph** to inspect entities, relationships and their source pages. Opening this tab reads saved results and does not initiate a model request.
4. Ask a question in that document's **Contract chat**. Hybrid passage retrieval supplies chunks; GraphRetriever adds relationship facts connected to those chunks. Extracted metadata remains available as additional cited context.
5. Check the retrieval trace and Agent activity for the graph facts actually supplied to the answer generator.

## Evidence and limits

Graph entities and relationships are checked against contract evidence. Unusable model output falls back to local graph rules. Storage reads newer `.review.json` artifacts before older `.graph.json` files, preserving saved review and metadata results. All contract routes still require the owning workspace header.

The restored retrieval uses direct evidence-linked relationships. It does not perform general multi-hop graph traversal. A graph picture or a correct answer alone does not demonstrate that graph facts were used; inspect the retrieval trace.

OCR still needs the separate Tesseract engine to read image-only pages on this Mac.

## Verification

Run the backend tests, frontend tests, TypeScript check and production build. Graph restoration tests verify evidence filtering, fallback, workspace isolation, preservation of metadata and saved scores, and graph-fact injection into both document and workspace chat prompts without contacting external models.
