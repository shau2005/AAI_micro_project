# Write-up: Legal Contract Review Agent (AAI Micro Project)

> **How to use this file:** each member copies **only their own part** onto paper. The text is written as answer-style paragraphs and short points, so it can be copied directly. Diagrams are kept simple so they can be drawn by hand.
>
> This version covers the complete system: **OCR with Tesseract**, the **MetadataAgent**, and **Graph RAG** (knowledge-graph retrieval), along with the multi-agent review, hybrid retrieval, tool calling and MCP.
>
> | Member | Part | Marks |
> |---|---|---|
> | Member 1 | Problem Definition, Agent Objectives, Workflow Diagram | 10 |
> | Member 2 | LLM Integration, Tool Calling, Memory / Context Reasoning, Autonomous Multitask Execution | 10 |
> | Member 3 | Testing, Error Handling | 5 (shared) |
> | Member 4 | Demonstration, Verification | 5 (shared) |

---
---

# MEMBER 1: Problem Definition, Agent Objectives and Workflow Diagram

## 1. Problem Definition

In India, people regularly sign property documents such as **sale deeds, gift deeds, leave-and-licence (rent) agreements, lease deeds, mortgage deeds, wills and power-of-attorney documents**. These documents are long, written in legal language, and often favour one party over the other. Many of them exist only as **scanned copies** (photographs or scans of stamped paper), which ordinary software cannot read.

A common person usually cannot easily find:
- **who** the parties are and what role each one plays (seller, buyer, licensor, licensee, donor, donee);
- the **important dates** (execution date, start and end of the agreement, registration date, deadlines);
- the **important numbers** (sale price, rent, security deposit, stamp duty, area of the property);
- the **relationships** between them (who pays how much to whom, who must hand over possession by which date);
- whether **required details or clauses are missing**, and which clauses are **risky** for them.

Lawyers are expensive, and general-purpose AI chatbots **hallucinate**: they may confidently describe clauses, names or amounts that do not exist in the document.

**Problem statement:**
To design and build an autonomous multi-agent AI system that reads Indian property contracts (including **scanned documents through OCR**), **extracts structured metadata** (names, roles, dates, amounts and the relationships between them), builds a **knowledge graph** of the contract, reviews the contract from the point of view of **both parties**, compares it with official deed checklists and government legal sources, gives an explainable health score, and answers user questions, while ensuring that **every extracted value, finding and answer is supported by an exact quote and page number from the original document**.

**Users who benefit:** home buyers and sellers, tenants and landlords, families preparing gift deeds or wills, property agents, and law students.

## 2. Agent Objectives

The overall objective of the system is to **read, understand, structure, analyse, verify and explain** a contract automatically. This large task is divided among specialised agents, each with one clear objective. A supervisor agent coordinates them.

**Supervisor**
- **MasterAgent:** decides the order in which agents run, runs independent agents in parallel, retries failed agents and records every step in an audit log.

**Reading and indexing agents**
- **Ingestion with OCR:** extracts text from each page of the PDF. If a page has no readable text (a scanned page), it converts the page into an image and reads it using **Tesseract OCR**. The text is then split into small page-referenced passages (chunks).
- **DocumentConfigAgent:** chooses settings suited to each document, such as search depth, batch size and number of retries.
- **ChunkOptimizer:** chooses the best chunk size and overlap so that clauses are not cut in half.

**Understanding agents**
- **ContractClassifierAgent:** identifies the type of document (for example sale deed or gift deed) and the jurisdiction, with a supporting quote.
- **MetadataAgent:** extracts the key facts of the document in a structured form: **party names and their roles**, **dates** (execution, start, end, registration), **numerical values** (price, rent, deposit, stamp duty, area, duration), **property details**, **witnesses**, and the **relationships between them** (for example *Licensee pays Rs. 28,000 per month to Licensor*). It also checks which **required details** for that document type are present or missing. Every value is stored with its page and quote.
- **GovernmentResearchAgent:** searches only official Indian government legal websites for laws relevant to the document type.

**Analysis agents**
- **InitialScan:** uses the LLM, together with the extracted metadata, to read the whole contract and find risks for both the **contract giver** and the **contract acceptor**.
- **GraphBuilder:** builds a **knowledge graph** of the contract, where nodes are parties, amounts, dates, property and obligations, and edges are the relationships between them.
- **ContractStructurer:** organises the text into sections and clauses.
- **SignatureVerifier:** looks for signatures, witnesses and seals.
- **IntentAgent:** detects hidden or suspicious instruction-like text in the document.
- **DeadlineAgent:** extracts deadline-related language.
- **ObligationAgent:** extracts duties (sentences with "shall" or "must") and identifies which party is responsible.

**Checking agents**
- **GraphValidator and GraphReviewerAgent:** remove invalid, duplicate or unsupported links from the graph and report disconnected entities.
- **CoverageAgent:** checks whether the expected types of clauses are present.
- **DocumentQualityAgent:** detects poorly extracted text, OCR pages, repeated text or empty pages.
- **SensitiveDataAgent:** detects personal data such as phone numbers, emails and ID numbers.
- **TemplateReviewAgent:** compares the document with official checklists for 8 types of Indian property deeds.

**Verification and scoring agents**
- **FixerAgent:** removes any finding that is not supported by evidence from the document.
- **CrossChecker:** does a final evidence check and removes duplicate findings.
- **ContractScorer:** calculates an explainable health score out of 100 for each party.

**Chat agents (Graph RAG)**
- **RetrieverAgent:** finds the most relevant passages of the contract for the user's question.
- **GraphRetriever:** adds the relationships from the knowledge graph that are connected to those passages.
- **AnswerGenerator:** uses the LLM to answer only from the passages, graph facts and metadata, and must cite the passages it used.

## 3. Workflow Diagram

*(Draw as boxes connected by arrows.)*

```
              [ User uploads contract PDF ]
                          |
                          v
     +--------------------------------------------+
     |  INGESTION                                 |
     |  Digital page -> read text directly        |
     |  Scanned page -> image -> Tesseract OCR    |
     |  Text -> page-referenced chunks            |
     |  DocumentConfigAgent, ChunkOptimizer       |
     |  Keyword index (BM25) + Vector index       |
     +--------------------------------------------+
                          |
                          v
     +--------------------------------------------+
     |  MASTER AGENT (Supervisor)                 |
     |                                            |
     |  ContractClassifierAgent                   |
     |          |                                 |
     |  MetadataAgent (names, roles, dates,       |
     |   amounts, relationships, required data)   |
     |          |                                 |
     |  GovernmentResearchAgent                   |
     |          |                                 |
     |  InitialScan (LLM + metadata, both sides)  |
     |          |                                 |
     |  Parallel: GraphBuilder | Structurer |     |
     |   Signature | Intent | Deadline |          |
     |   Obligation                               |
     |          |                                 |
     |  GraphValidator -> GraphReviewerAgent      |
     |          |                                 |
     |  Parallel: Coverage | Quality | Sensitive  |
     |          |                                 |
     |  TemplateReviewAgent                       |
     |          |                                 |
     |  For each party:                           |
     |  Fixer -> CrossChecker -> Scorer           |
     +--------------------------------------------+
                          |
                          v
   [ Metadata + Knowledge graph + Giver report + Acceptor report saved ]

  CHAT (Graph RAG):
  [ User question ] -> [ Query rewrite ] -> [ Hybrid search (BM25 + vectors) ]
        -> [ GraphRetriever adds linked graph facts ] + [ Metadata ]
        -> [ LLM answer with citations ] -> [ Citation check ]
        -> [ Answer ]  or  [ Source excerpts if not verified ]
```

**Explanation of the workflow:**
1. **Upload and OCR:** the user uploads a PDF. Each page is read directly if it contains digital text. If a page is scanned, it is converted to an image and read with Tesseract OCR. The text is split into chunks and indexed in two ways: a keyword index (BM25) and a meaning-based vector index (embeddings in ChromaDB).
2. **Understanding:** the MasterAgent classifies the document and then the MetadataAgent extracts the names, roles, dates, amounts, property details and relationships, and checks which required details are missing. Official legal sources are then researched.
3. **Risk analysis:** the InitialScan agent sends the contract and its metadata to the LLM and receives risk findings for both parties.
4. **Parallel extraction:** the GraphBuilder and five other independent agents run at the same time to save time. The graph is then validated and reviewed, followed by three quick checking agents in parallel.
5. **Template check:** the document is compared with the official checklist for its deed type.
6. **Verification and scoring:** for each party, the Fixer and CrossChecker remove unsupported findings, and the Scorer calculates the health score.
7. **Chat with Graph RAG:** when the user asks a question, the relevant passages are retrieved, the graph relationships connected to those passages are added, and the LLM answers with citations. If the answer cannot be verified, the original passages are shown instead.

---
---

# MEMBER 2: LLM Integration, Tool Calling, Memory / Context Reasoning and Autonomous Multitask Execution

## 1. LLM Integration

The system uses a **Large Language Model (LLM)** for the tasks that need language understanding. The default model is **Google Gemini** (`gemini-flash-lite-latest`), accessed through the `google-genai` Python SDK. The system also supports **local models through Ollama**, which allows it to run fully offline. The user chooses the model from the user interface.

**Tasks performed by the LLM:**
1. **Classification:** identifies the document type, jurisdiction and confidence, with a supporting quote.
2. **Metadata extraction:** extracts parties, roles, dates, amounts, property details and relationships in a fixed JSON format, with a quote for every value.
3. **Knowledge graph extraction:** extracts entities and relationships for the graph, each with evidence.
4. **Risk analysis (InitialScan):** finds risks for both parties in a single call for each batch of text.
5. **Query rewriting:** converts follow-up chat questions into complete search queries.
6. **Answer generation:** answers user questions using only the retrieved passages, graph facts and metadata.

**Structured output:** instead of accepting free-form text, every LLM call includes a **JSON schema**, and the model must return data in that fixed format. For example, each metadata value must contain a label, the value, the page and the exact quote; each risk finding must contain a category, a severity (CRITICAL, HIGH, MEDIUM or LOW), the claim, page, clause, quote, reasoning and recommendation. This makes the output easy for the program to check.

**Hybrid AI design:** for metadata and the graph, the system combines the **LLM** with **local rule-based extraction** (regular expressions for names, roles, dates and amounts). The local rules work even without an internet connection, and the LLM adds understanding of complex sentences. Only values that can be found in the document text are kept.

**Other design choices:**
- **Temperature 0** is used for extraction and classification, so the same contract gives consistent results.
- The prompt tells the model to treat the contract as **untrusted data** and to ignore any instructions written inside it.
- The model is told to answer **only from the given evidence** and to say clearly when the answer is not in the document.
- Long contracts are divided into **batches** that fit within the model's context limit, so every part of the contract is reviewed.

## 2. Tool Calling

Agents in the system use external and internal **tools** to complete their tasks.

**a) OCR tool (Tesseract):**
When a page of the PDF has no digital text, the ingestion agent renders the page as a high-resolution image using PyMuPDF and passes it to **Tesseract OCR** (through the `pytesseract` library), which converts the image into text. This allows scanned contracts to be reviewed like digital ones.

**b) Web search tool (Tavily):**
The GovernmentResearchAgent uses the Tavily search API to find relevant laws and rules. The search is **restricted to official Indian government websites** only: `indiacode.nic.in`, `legislative.gov.in`, `egazette.nic.in`, `gov.in` and `nic.in`. Only the document type and jurisdiction are sent in the query; **no contract text is sent to the internet**. The results are given to the review as separate legal context, not as evidence from the contract.

**c) MCP (Model Context Protocol) server:**
MCP is an open standard that allows AI applications to discover and use external tools. Our MCP server exposes two tools: `classify_contract_document` (document type, confidence and supporting quote) and `search_official_legal_sources` (official Indian legal search). Any MCP-compatible AI assistant can connect to this server and use these tools. Inside our own application, the same functions are called directly.

**d) Internal tools used by agents:**
PyMuPDF for reading PDFs, BM25 for keyword search, the MiniLM embedding model and ChromaDB for meaning-based search, the knowledge-graph builder and validator, the deed-checklist matcher, and pattern (regex) detectors for names, dates, amounts, duties and sensitive data.

## 3. Memory and Context Reasoning

The system uses several kinds of memory so that it can reason correctly over the contract and the conversation.

**a) Conversation memory (short-term):**
All chat messages are saved in an SQLite database. The **last 8 messages** are included in each prompt, so the model understands the flow of the conversation.

**b) Context reasoning for follow-up questions:**
If the user asks a follow-up question such as *"What is its deadline?"*, the word "its" is unclear on its own. The LLM **rewrites the question into a standalone search query** using the **last 4 user questions**. If the rewriting fails, the original question is used.

**c) Shared working memory between agents:**
All agents share a common object called **AgentContext**, which holds the chunks, the selected model, the classification, the metadata, the research results, the graph and the findings. Later agents build on earlier results; for example, the MetadataAgent uses the document type from the classifier, and the InitialScan uses the metadata to know who the parties are.

**d) Structured document memory (Metadata):**
The metadata extracted by the MetadataAgent is saved with the contract. It acts as a **summary card** of the document: parties and roles, dates, amounts and relationships. It is added to the chat prompt, so questions like *"Who is the licensee?"* or *"What is the deposit?"* can be answered correctly even if the search does not return the exact passage.

**e) Long-term document memory (Retrieval-Augmented Generation):**
The contract is stored in two indexes:
- a **BM25 keyword index**, good for exact words such as names, amounts and clause numbers;
- a **vector index** of 384-dimension embeddings from the MiniLM model in ChromaDB, good for passages with similar meaning (for example "rent" matching "licence fee").

The results of both searches are combined using **Reciprocal Rank Fusion**, where each passage gets the score **Σ 1 / (60 + rank)**.

**f) Graph memory (Graph RAG):**
The **knowledge graph** stores the contract as connected facts, for example *Licensee → pays → Rs. 28,000 → to → Licensor*. When passages are retrieved for a question, the **GraphRetriever** adds the graph relationships supported by those passages. This gives the LLM the **connections between facts**, not just isolated sentences, which improves answers to questions such as *"Who has to pay what, and to whom?"*

**g) Workspace memory and caching:**
The chat can answer across **several contracts** in the same workspace. Each contract is identified by the **SHA-256 hash** of the file, so uploading the same file again reuses the stored index.

## 4. Autonomous Multitask Execution

After the user uploads a contract, the system performs the complete process **automatically, without any further user action**: OCR (if needed), indexing, metadata extraction, graph building, review and scoring. It runs as a **background task**, and the user sees a live progress bar.

**Role of the MasterAgent (supervisor):**
- **Planning the order:** tasks that depend on others run later. Classification runs before metadata extraction, metadata before the risk scan, and verification and scoring last.
- **Parallel execution:** independent agents run at the same time using a thread pool. Six agents (GraphBuilder, structure, signature, intent, deadline, obligation) run together, and then three checking agents run together. This reduces the total review time.
- **Retries:** if an agent fails, it is retried up to 2 times. A model **timeout** is not retried; the system switches to the fallback so the user doesn't wait repeatedly.
- **Monitoring:** the duration, attempts and result of every agent are recorded in an audit log and shown in the **Agent Activity** panel.

**Self-adjusting behaviour:**
- Each page is automatically read either directly or through OCR, depending on whether it contains digital text.
- The DocumentConfigAgent and ChunkOptimizer change the settings for each document based on its size and structure.
- If the LLM is unavailable, metadata, the graph and the review **automatically switch to local rule-based extraction**, and both reports are still produced.

**Multiple outputs from one run:** a single run produces the **metadata card**, the **knowledge graph**, and **two complete reports** (contract giver and contract acceptor), each with its own findings and score.

---
---

# MEMBER 3: Testing and Error Handling

## 1. Testing

The project is tested with **automated tests** and **manual tests**.

**Automated tests**
- **Backend tests** written with **pytest** (command: `python -m pytest backend/tests -q`).
- **Frontend tests** written with **node:test** (command: `npm test`).
- In total **77 automated tests (66 backend + 11 frontend), all passing**, including 15 tests for the MetadataAgent and 11 for OCR. The live OCR tests convert each sample contract into a scanned (image-only) PDF, read it with Tesseract, and check that the extracted names, amounts and dates are **exactly the same** as those from the original digital PDF.

**Areas covered by the backend tests:**
1. **Metadata extraction:** party names and roles, dates, amounts, durations and property details are extracted correctly from the sample contracts; relationships connect the right parties and amounts; missing required details are reported; values that are not in the document are rejected.
2. **OCR:** a scanned (image-only) page is read through Tesseract and produces text and chunks; digital pages are not sent to OCR; a clear message is given if Tesseract is not installed.
3. **Knowledge graph:** only relationships with real evidence are kept; invalid, duplicate or unsupported links are removed; a local graph is built if the model fails.
4. **Security:** detection of prompt-injection text, and rejection of evidence that does not exist in the document.
5. **Hallucination control:** chat returns cited source passages instead of an unverified answer.
6. **Fallback behaviour:** the review is completed with local rules when the model is unavailable.
7. **Timeouts and retries:** a Gemini timeout stops without repeated attempts; temporary failures are retried.
8. **Extraction accuracy:** dates written in words, duties in passive voice, and duties assigned to the correct party.
9. **API behaviour:** scores are saved correctly, workspaces stay separate, and the chat uses the correct model.

**Manual testing:**
The three sample contracts (sale deed, gift deed, leave-and-licence agreement), filled samples of **8 Indian property deed types**, and a **scanned copy** of a contract were uploaded. For each, we checked that the text (or OCR text) was extracted, the metadata card showed the correct names, dates and amounts, the graph showed correct relationships, both reports were generated, evidence links opened the correct page, and the chat gave cited answers.

## 2. Error Handling

The system is designed so that **the user always receives a result, and never an unverified one**. The main errors and how they are handled:

| Error | Handling |
|---|---|
| File is not a PDF | Rejected. Only files with a PDF type and the `%PDF` signature are accepted. |
| Scanned PDF | Read automatically using Tesseract OCR. |
| Tesseract not installed, or OCR finds no text | Clear message explaining that OCR is needed and how to enable it. |
| LLM metadata output contains a value not in the document | That value is discarded; locally extracted values are kept. |
| Gemini overloaded (error 503) | Retried with increasing wait times (exponential backoff). |
| Gemini does not respond within 60 seconds | Treated as a timeout; no repeated waiting; local rules are used. |
| Wrong API key or model (errors 401, 403, 404) | Stops immediately with a clear message telling the user what to fix. |
| Graph extraction fails | A conservative local graph is built instead. |
| An agent fails | The MasterAgent retries it up to 2 times and records the failure. |
| Chat answer fails or has no valid citation | The original contract passages are shown instead. |
| Tavily key missing | The review continues; research reports that it could not run. |
| Review fails completely | The status is set to "failed" with the reason, so it never stays stuck on "running". |

All errors are recorded in an **audit log** (`data/audit/events.jsonl`) for later checking.

---
---

# MEMBER 4: Demonstration and Verification

## 1. Demonstration

The working of the system was demonstrated with the sample leave-and-licence agreement and a scanned contract.

**Steps of the demonstration:**
1. The application was started; the backend runs on port 8000 and the frontend on port 5173.
2. The **digital PDF** `sample_leave_and_licence.pdf` was uploaded and a Gemini model was selected.
3. The progress bar and the **Agent Activity** panel showed each agent running, some in parallel.
4. The **Metadata** view showed the extracted details: the licensor and licensee with their roles, the licence period with start and end dates, the monthly licence fee, the security deposit and the property address, each with its page and quote. Missing required details were listed.
5. The **Relationship graph** showed the parties connected to amounts, dates and duties, for example *Licensee → pays → licence fee*.
6. **Two reports** were shown: one for the **Contract Giver** (licensor) and one for the **Contract Acceptor** (licensee), with different risks for each party.
7. Clicking a finding opened the **exact page and quote** in the original PDF. The **health score** and the **deed checklist** result were shown.
8. In the chat, *"What is the security deposit?"* was answered as **Rs. 56,000, refundable**, with a citation, and *"Who is the licensee?"* was answered correctly using the metadata and graph.
9. A question whose answer is not in the contract was asked, and the system said it **could not determine** the answer.
10. A **scanned PDF** was uploaded. The system read it using **OCR**, and the same metadata, graph and reports were produced.

**Result:** the system read both digital and scanned contracts, extracted their key facts and relationships, reviewed them from both parties' points of view, and answered questions accurately with citations.

## 2. Verification

Verification means checking that the output of the AI is correct and supported by the document. The project verifies AI output in the following ways:

1. **Metadata grounding:** every extracted name, date and amount must have a quote that **actually appears** in the document on the stated page. Values without a matching quote are discarded.
2. **Required-data check:** for each document type, the list of required details (for example licensor, licensee, rent, deposit and period for a leave and licence agreement) is checked, and missing items are reported instead of being guessed.
3. **Graph validation:** every graph relationship must be supported by a quote from the document. Links to unknown entities, self-links and duplicates are removed.
4. **OCR quality check:** pages read by OCR are marked, and the DocumentQualityAgent reports noisy or empty OCR text, so the user knows which parts came from OCR.
5. **Finding verification:** the **FixerAgent** removes unsupported findings and the **CrossChecker** performs a final check and removes duplicates, separately for both parties.
6. **Chat citation check:** the LLM must return the IDs of the passages it used, and these must match the passages that were actually retrieved. Otherwise the answer is not shown and the original passages are shown instead.
7. **Explainable score:** the formula is shown to the user:
   **Score = 100 − finding penalties − missing-clause penalty**,
   where each finding reduces the score by CRITICAL 28, HIGH 16, MEDIUM 7 or LOW 2 points, and the missing-clause penalty is at most 20.
8. **Human in the loop and audit trail:** the user can accept or reject each finding, and every agent's action is logged for later checking.

**Conclusion:**
In this system, the AI **proposes** values, relationships, findings and answers, and deterministic program code **verifies** them against the original document. The system may occasionally miss something, but it is designed never to show a value or claim that cannot be proved from the contract.
