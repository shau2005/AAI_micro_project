import React, {useEffect, useMemo, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import {Activity, AlertTriangle, ArrowUpRight, CheckCircle2, ChevronRight, FileText, Info, Maximize2, Plus, RotateCcw, Send, ShieldCheck, Sparkles, Upload, X, ZoomIn, ZoomOut, MessageSquare, ListChecks, Network, BookOpen} from 'lucide-react';
import './style.css';
import {PdfLink, PdfProvider} from './PdfLinks';

const API = `${import.meta.env.VITE_API_URL || 'http://localhost:8000'}/api`;
const REVIEW_QUESTION = 'Review financial, liability, privacy, intellectual property, compliance, and termination risks.';
let currentContractId = '';
const CURRENT_AGENTS = new Set(['Ingestion','DocumentConfigAgent','ChunkOptimizer','ContractClassifierAgent','GovernmentResearchAgent','InitialScan','GraphBuilder','GraphValidator','GraphReviewerAgent','FixerAgent','TemplateReviewAgent','CrossChecker','ContractStructurer','SignatureVerifier','IntentAgent','DeadlineAgent','ObligationAgent','CoverageAgent','DocumentQualityAgent','SensitiveDataAgent','ContractScorer','RetrieverAgent','GraphRetriever','AnswerGenerator']);
const AGENT_DESCRIPTIONS: Record<string,string> = {
  Ingestion:'Extracts PDF text, applies finalized chunk settings, and builds local embeddings/indexes.', DocumentConfigAgent:'Profiles this document and chooses bounded indexing, retrieval, and review settings.', ChunkOptimizer:'Finalizes chunk size and overlap before indexing.', ContractClassifierAgent:'Identifies likely document type and jurisdiction with supporting evidence.', GovernmentResearchAgent:'Searches official government legal sources and supplies linked results as context to contract review.', InitialScan:'Scans the complete contract for evidence-backed risk clauses.', GraphBuilder:'Extracts named contract entities and evidence-backed relations with the selected model, then verifies each quote against the source.', GraphValidator:'Checks graph integrity and removes invalid links.', GraphReviewerAgent:'Reviews graph links and reports disconnected or malformed relationships.', FixerAgent:'Removes unsupported findings and repairs invalid or duplicate graph links.', TemplateReviewAgent:'Compares Indian property deeds with the included checklists; reports gaps and red flags.', CrossChecker:'Checks findings against exact evidence and removes duplicates.', ContractStructurer:'Groups chunks into clauses, sections, pages, and coverage.', SignatureVerifier:'Checks signature, seal, witness, and authority signals.', IntentAgent:'Detects suspicious instruction-like or hidden-intent signals.', DeadlineAgent:'Extracts dates and checks deadline context.', ObligationAgent:'Extracts shall/must duties and responsible parties.', CoverageAgent:'Checks expected legal and commercial clause families.', DocumentQualityAgent:'Checks extraction quality and OCR-like noise.', SensitiveDataAgent:'Detects sensitive-data patterns locally.', ContractScorer:'Calculates the explainable contract health score.', RetrieverAgent:'Retrieves contract chunks to answer questions.', GraphRetriever:'Connects retrieved chunks to graph facts.', AnswerGenerator:'Produces grounded answers or abstains when retrieved evidence is insufficient.'
};

type Contract = {
  contract_id: string; original_filename: string; processing_status: string;
  page_count: number; chunk_count: number; indexing_stage: string; indexing_progress: number;
  analysis_status: string; analysis_progress: number; analysis_stage: string; selected_model?: string;
};
type Citation = {page: number; clause?: string; quote: string; chunk_id: string};
type RetrievalTrace = {query?: string; queries?: Record<string,string>; candidate_chunk_ids?: string[]; answer_chunk_ids?: string[]; graph_facts?: string};
type Message = {role: string; content: string; citations?: Citation[]; model?: string; retrieval_trace?: RetrievalTrace};
type Finding = {finding_id: string; category: string; severity: string; claim: string; recommendation: string; proposed_language?: string; reasoning?: string; evidence?: Citation[]};
type ReviewResult = {findings: Finding[]; summary?: {score?: number | null; rationale?: string}};
type Review = ReviewResult & {perspective_reviews?: Record<string,ReviewResult>};
type Model = {id: string; name: string; provider: string};
type GraphProof = {chunk_id: string; page: number; quote: string};
type GraphNode = {id: string; label: string; kind: string; evidence?: GraphProof[]};
type GraphEdge = {source: string; target: string; relation: string; confidence?: number; term?: string; entity_type?: string; chunk_id?: string; page?: number; evidence?: string; evidence_sources?: GraphProof[]};
type ContractGraph = {graph?: {nodes: GraphNode[]; edges: GraphEdge[]; extraction?: {method?: string; model?: string; warning?: string; input_chars?: number}; document_name?: string; validation?: {valid: boolean; node_count: number; edge_count: number; duplicate_edges_removed?: number; invalid_edges_removed?: number}; legend?: Record<string, string>}; classification?: {document_type?: string; confidence?: string; jurisdiction?: string; alternatives?: string[]; reasoning?: string; method?: string; evidence?: {page?: number; quote?: string}}; government_research?: {status?: string; as_of?: string; query?: string; note?: string; sources?: {title: string; url: string; source_domain?: string; snippet?: string; published_date?: string}[]}; document_config?: {embedding_model?: string; embedding_dimension?: number; embedding_batch_size?: number; embedding_max_tokens?: number; recommended_chunk_size?: number; recommended_overlap?: number; top_k_bm25?: number; top_k_vector?: number; top_k_rerank?: number; review_context_chars?: number; max_retries?: number; complexity?: string}; structure?: {section_count?: number; chunk_count?: number}; signature?: {status?: string; signatory_candidates?: string[]; seal_present?: boolean; authority_concerns?: string[]; notes?: string}; document_quality?: {status?: string; warnings?: string[]}; coverage?: {present?: string[]; missing?: string[]}; deadlines?: {dates?: {value: string; page: number}[]; deadline_signals?: unknown[]}; obligations?: {obligations?: unknown[]; unassigned_count?: number}; graph_review?: {status?: string; relationship_count?: number; issues?: string[]; isolated_nodes?: string[]}; template_review?: {status?: string; detected_type?: string; detected_type_name?: string; detection_confidence?: string; candidate_types?: string[]; match_score?: number; verdict?: string; summary?: string; missing_clauses?: {title: string; severity: string; guidance?: string}[]; red_flags?: {title: string; why: string; evidence: string}[]; present_clauses?: {title: string; strength: string}[]; sources?: string[]}; fixer?: {findings_removed?: number; edges_removed?: number; nodes_removed?: number; status?: string}};
type AgentTelemetry = {master?: {status: string; accessible_log: boolean; supervises?: number}; agents: Record<string, {runs: number; failures: number; retries: number; last_status: string; contribution?: string; last_detail?: string}>; events: {agent: string; action: string; status?: string; attempt?: number; duration_ms?: number; error?: string; timestamp?: string; contract_id?: string; contribution?: string; detail?: string}[]};
type MCPStatus = {server_status?: string; transport?: string; internet_search_status?: string; tools?: string[]};

function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [active, setActive] = useState<Contract>();
  const [review, setReview] = useState<Review & {agents?: ContractGraph}>();
  const [contractGraph, setContractGraph] = useState<ContractGraph>();
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [chatBusy, setChatBusy] = useState(false);
  const [models, setModels] = useState<Model[]>([]);
  const [analysisModel, setAnalysisModel] = useState('');
  const [chatModel, setChatModel] = useState('');
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const [mcpStatus, setMcpStatus] = useState<MCPStatus>();
  const [reviewPerspectives, setReviewPerspectives] = useState<Record<string,string>>({});
  const [telemetry, setTelemetry] = useState<AgentTelemetry>({master: {status: 'waiting', accessible_log: true}, agents: {}, events: []});
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelPoll = useRef<() => void>(() => {});
  const workspaceId = useMemo(() => {
    const key = 'ps9-workspace-id';
    let id = sessionStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); sessionStorage.setItem(key, id); }
    return id;
  }, []);
  const readyIds = useMemo(() => new Set(contracts.filter(c => c.processing_status === 'ready').map(c => c.contract_id)), [contracts]);
  const ready = active?.processing_status === 'ready';
  const reviewPerspective = active ? reviewPerspectives[active.contract_id] || 'contract_giver' : 'contract_giver';
  const fetchApi = (input: RequestInfo | URL, init: RequestInit = {}) =>
    fetch(input, {...init, headers: {...(init.headers || {}), 'X-Workspace-ID': workspaceId}});

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchApi(`${API}/contracts`).then(r => r.json()),
      fetchApi(`${API}/models`).then(r => r.json()),
      fetchApi(`${API}/mcp/status`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]).then(([loadedContracts, available, mcp]) => {
      if (cancelled) return;
      setContracts(loadedContracts);
      setSelectedIds(loadedContracts.filter((c: Contract) => c.processing_status === 'ready').map((c: Contract) => c.contract_id));
      setModels(available.models || []);
      setAnalysisModel(available.default || '');
      setChatModel(available.default || '');
      setMcpStatus(mcp || undefined);
    }).catch(error => console.error('Could not load workspace', error));
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!active || active.processing_status === 'failed' || (ready && !['queued', 'running'].includes(active.analysis_status))) return;
    let cancelled = false;
    const timer = window.setInterval(async () => {
      const response = await fetchApi(`${API}/contracts/${active.contract_id}`);
      if (!cancelled && response.ok) {
        const next: Contract = await response.json();
        setActive(next);
        setContracts(items => items.map(item => item.contract_id === next.contract_id ? next : item));
        if (next.processing_status === 'ready') setSelectedIds(ids => ids.includes(next.contract_id) ? ids : [...ids, next.contract_id]);
        if (next.analysis_status === 'complete' && active.analysis_status !== 'complete') {
          const report = await fetchApi(`${API}/contracts/${next.contract_id}/review`);
          if (!cancelled && report.ok) {
            const loaded = await report.json();
            setReview(loaded);
            setContractGraph(loaded.agents || undefined);
          }
        }
      }
    }, 700);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.contract_id, active?.processing_status, active?.analysis_status]);

  useEffect(() => () => cancelPoll.current(), [active?.contract_id]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const loadTelemetry = async () => {
      const response = await fetchApi(`${API}/agents/telemetry?contract_id=${encodeURIComponent(active.contract_id)}`);
      if (!cancelled && response.ok) {
        const next: AgentTelemetry = await response.json();
        const agents=Object.fromEntries([...CURRENT_AGENTS].map(name => [name, {...((next.agents || {})[name] || {}), runs:(next.agents || {})[name]?.runs || 0, failures:(next.agents || {})[name]?.failures || 0, retries:(next.agents || {})[name]?.retries || 0, last_status:(next.agents || {})[name]?.last_status || 'waiting', contribution:(next.agents || {})[name]?.contribution || AGENT_DESCRIPTIONS[name], last_detail:(next.agents || {})[name]?.last_detail || 'Waiting for this agent to run.'}]));
        setTelemetry({
          ...next,
          agents,
          events: (next.events || []).filter(event => CURRENT_AGENTS.has(event.agent) && (!event.contract_id || event.contract_id === active.contract_id)),
        });
      }
    };
    loadTelemetry();
    const timer = window.setInterval(loadTelemetry, active.analysis_status === 'running' || active.analysis_status === 'queued' ? 900 : 3000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [active?.contract_id, active?.analysis_status]);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    fetchApi(`${API}/contracts/${active.contract_id}/graph`).then(response => response.ok ? response.json() : null)
      .then(value => { if (!cancelled && value) setContractGraph(value); })
      .catch(() => { if (!cancelled) setContractGraph(undefined); });
    return () => { cancelled = true; };
  }, [active?.contract_id, active?.analysis_status]);

  const load = async (contract: Contract) => {
    setAnalysisOpen(false);
    setGraphOpen(false);
    const [contractResponse, reviewResponse, messagesResponse] = await Promise.all([
      fetchApi(`${API}/contracts/${contract.contract_id}`),
      fetchApi(`${API}/contracts/${contract.contract_id}/review`),
      fetchApi(`${API}/workspace/messages`),
    ]);
    const next = contractResponse.ok ? await contractResponse.json() : contract;
    setActive(next);
    setContracts(items => items.map(item => item.contract_id === next.contract_id ? next : item));
    const loadedReview = reviewResponse.ok ? await reviewResponse.json() : {findings: []};
    setReview(loadedReview);
    setContractGraph(loadedReview.agents || undefined);
    setMessages(messagesResponse.ok ? await messagesResponse.json() : []);
  };

  const upload = async () => {
    if (!files.length) return;
    setBusy(true);
    try {
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('model', analysisModel || 'local');
        form.append('perspective', 'contract_giver');
        const response = await fetchApi(`${API}/contracts`, {method: 'POST', body: form});
        if (!response.ok) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail.detail || `Upload failed (${response.status})`);
        }
        const contract: Contract = await response.json();
        setContracts(items => [contract, ...items.filter(item => item.contract_id !== contract.contract_id)]);
        setActive(contract);
        setReview({findings: []});
        setContractGraph(undefined);
        setAnalysisOpen(false);
        setGraphOpen(false);
      }
      setFiles([]);
    } catch (error) {
      console.error('Upload failed', error);
      window.alert(error instanceof Error ? error.message : 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  const ask = async (event?: React.FormEvent) => {
    event?.preventDefault();
    if (!ready || !question.trim() || !selectedIds.some(id => readyIds.has(id)) || chatBusy) return;
    const text = question.trim();
    setQuestion('');
    setChatBusy(true);
    setMessages(items => [...items, {role: 'user', content: text}]);
    try {
      const response = await fetchApi(`${API}/workspace/chat`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({message: text, contract_ids: selectedIds.filter(id => readyIds.has(id)), model: chatModel || null}),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || `Chat request failed (${response.status})`);
      const reply: Message = await response.json();
      setMessages(items => [...items, reply]);
    } catch (error) {
      setMessages(items => [...items, {role: 'assistant', content: `Model API error: ${error instanceof Error ? error.message : String(error)}`}]);
    } finally { setChatBusy(false); }
  };

  const runReview = async () => {
    if (!active || !ready || busy) return;
    setBusy(true);
    try {
      const response = await fetchApi(`${API}/contracts/${active.contract_id}/review`, {
        method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({question: REVIEW_QUESTION, model: analysisModel || 'local', perspectives: ['contract_giver','contract_acceptor']}),
      });
      if (!response.ok) throw new Error(`Review request failed (${response.status})`);
      cancelPoll.current();
      let cancelled = false;
      cancelPoll.current = () => { cancelled = true; };
      const poll = async () => {
        if (cancelled) return;
        const statusResponse = await fetchApi(`${API}/contracts/${active.contract_id}`);
        if (statusResponse.ok) {
          const next: Contract = await statusResponse.json();
          setActive(next);
          setContracts(items => items.map(item => item.contract_id === next.contract_id ? next : item));
          if (next.analysis_status === 'complete' || next.analysis_status === 'failed') {
            const report = await fetchApi(`${API}/contracts/${active.contract_id}/review`);
            const loadedReport = await report.json();
            setReview(loadedReport);
            setContractGraph(loadedReport.agents || undefined);
            setBusy(false);
            return;
          }
        }
        window.setTimeout(poll, 700);
      };
      poll();
    } catch (error) {
      setBusy(false);
      console.error('Review request failed', error);
      window.alert(error instanceof Error ? error.message : 'Review request failed');
    }
  };

  const hasBothPerspectives = Boolean(review?.perspective_reviews?.contract_giver && review?.perspective_reviews?.contract_acceptor);
  const selectedReview = review?.perspective_reviews ? review.perspective_reviews[reviewPerspective] : reviewPerspective === 'contract_giver' ? review : undefined;
  const findings = selectedReview?.findings || [];
  const evidence = [...messages].reverse().find(message => message.role === 'assistant' && message.citations?.length)?.citations || [];
  const counts = {
    high: findings.filter(f => ['HIGH', 'CRITICAL'].includes(f.severity)).length,
    medium: findings.filter(f => f.severity === 'MEDIUM').length,
    low: findings.filter(f => f.severity === 'LOW').length,
  };
  return <PdfProvider apiBase={API} workspaceId={workspaceId}><div className="app"><Header onNew={() => inputRef.current?.click()}/><div className="shell">
    <ContractSidebar contracts={contracts} active={active} selectedIds={selectedIds} onToggle={id => setSelectedIds(ids => ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])} files={files} busy={busy} inputRef={inputRef} onFiles={setFiles} onPick={() => inputRef.current?.click()} onUpload={upload} onLoad={load} models={models} reviewModel={analysisModel} setReviewModel={setAnalysisModel}/>
    <main>{!active ? <Welcome onPick={() => inputRef.current?.click()}/> : <div className="chat-layout">
      <ChatColumn active={active} ready={ready} messages={messages} evidence={evidence} graph={contractGraph} telemetry={telemetry} mcpStatus={mcpStatus} question={question} setQuestion={setQuestion} ask={ask} chatBusy={chatBusy} analysisOpen={analysisOpen} setAnalysisOpen={setAnalysisOpen} graphOpen={graphOpen} setGraphOpen={setGraphOpen} model={chatModel} setModel={setChatModel} models={models} reviewPanel={<ReportRail findings={findings} counts={counts} score={selectedReview?.summary?.score} scoreRationale={selectedReview?.summary?.rationale} graph={contractGraph} busy={busy} analysisStatus={active.analysis_status} analysisProgress={active.analysis_progress} analysisStage={active.analysis_stage} perspective={reviewPerspective} hasBothPerspectives={hasBothPerspectives} onPerspectiveChange={value => setReviewPerspectives(previous => ({...previous,[active.contract_id]:value}))} onOpenAnalysis={() => { setAnalysisOpen(true); setGraphOpen(false); }} onRetry={runReview}/>}/>
    </div>}</main>
  </div></div></PdfProvider>;
}

function Header({onNew}: {onNew: () => void}) {
  return <header className="app-header"><div className="brand"><span className="brand-mark"><ShieldCheck size={24}/></span><div><strong>PS-9</strong><span>CONTRACT REVIEW</span></div></div><div className="header-context"><span>Legal intelligence</span><span className="context-separator">/</span><strong>Review workspace</strong></div><button className="new" onClick={onNew}><Plus size={18}/> New contract</button></header>;
}

function Welcome({onPick}: {onPick: () => void}) {
  return <div className="welcome"><span className="welcome-kicker"><ShieldCheck size={18}/> Evidence-led contract review</span><h1>Read the fine print.<br/><span>See the bigger picture.</span></h1><p>A clear workspace for understanding your contracts, comparing both parties’ interests, and checking every concern against the original document.</p><button className="primary" onClick={onPick}><Upload size={20}/> Upload a contract</button><span className="welcome-format">PDF documents · Automatic review · Source-linked answers</span><div className="welcome-features"><article><span><FileText size={22}/></span><h2>Bring your document</h2><p>Upload an agreement, deed, or tender. The review starts automatically.</p></article><article><span><ShieldCheck size={22}/></span><h2>Understand the risks</h2><p>Compare party perspectives and see which clauses deserve attention.</p></article><article><span><MessageSquare size={22}/></span><h2>Ask with confidence</h2><p>Get plain-language answers with links to the supporting contract text.</p></article></div><div className="welcome-note"><Info size={18}/><span>AI helps you find and understand review points. Always check the cited wording before making a decision.</span></div></div>;
}

function ContractSidebar({contracts, active, selectedIds, onToggle, files, busy, inputRef, onFiles, onPick, onUpload, onLoad, models, reviewModel, setReviewModel}: {contracts: Contract[]; active?: Contract; selectedIds: string[]; onToggle: (id: string) => void; files: File[]; busy: boolean; inputRef: React.RefObject<HTMLInputElement | null>; onFiles: (files: File[]) => void; onPick: () => void; onUpload: () => void; onLoad: (contract: Contract) => void; models: Model[]; reviewModel: string; setReviewModel: (value: string) => void}) {
  return <aside className="contracts"><div className="sidebar-heading"><span className="eyebrow">YOUR WORKSPACE</span><h2>Documents <span>{contracts.length}</span></h2></div><button className="drop-mini" onClick={onPick}><span className="upload-icon"><Upload size={24}/></span><strong>Add a contract</strong><small>Choose a PDF to review</small></button><input ref={inputRef} hidden type="file" multiple accept="application/pdf" onChange={event => onFiles(Array.from(event.target.files || []))}/>{files.length > 0 && <div className="queued"><strong>{files.length} document{files.length > 1 ? 's' : ''} ready</strong><ul>{files.map(file=><li key={file.name}>{file.name}</li>)}</ul><label className="upload-model">Review model<select value={reviewModel} onChange={event => setReviewModel(event.target.value)} disabled={busy}><option value="">Local review · no model</option>{models.map(model=><option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label><p className="model-hint">The selected model reviews both parties’ perspectives.</p><button className="primary" onClick={onUpload} disabled={busy}>{busy ? 'Uploading…' : 'Upload & review'}</button></div>}<div className="side-title recent">Contract library</div>{contracts.length ? <><p className="sidebar-help">Check documents to include them in chat.</p><div className="contract-list">{contracts.map(contract=><div className={'contract-row '+(active?.contract_id===contract.contract_id?'is-active':'')} key={contract.contract_id}><input type="checkbox" disabled={contract.processing_status!=='ready'} checked={selectedIds.includes(contract.contract_id)} onChange={()=>onToggle(contract.contract_id)} aria-label={`Use ${contract.original_filename} in chat`}/><button className={'contract '+(active?.contract_id===contract.contract_id?'selected':'')} aria-current={active?.contract_id===contract.contract_id?'page':undefined} onClick={()=>onLoad(contract)}><FileText size={21}/><span><b title={contract.original_filename}>{contract.original_filename.replace(/\.pdf$/i,'').replace(/_/g,' ')}</b><small>{contract.processing_status==='ready'?`${contract.page_count} pages · ${contract.analysis_status==='complete'?'Reviewed':contract.analysis_status==='failed'?'Review needs attention':'Review in progress'}`:`${contract.indexing_progress||0}% · ${contract.indexing_stage}`}</small></span></button></div>)}</div></> : <div className="library-empty"><FileText size={24}/><strong>Your library starts here</strong><p>Uploaded contracts will appear here for review and chat.</p></div>}<div className="sidebar-footer"><ShieldCheck size={19}/><div><strong>Your local workspace</strong><p>Documents and reviews are saved on this computer.</p></div></div></aside>;
}

function ChatColumn(props: {active: Contract; ready: boolean; messages: Message[]; evidence: Citation[]; graph?: ContractGraph; telemetry: AgentTelemetry; mcpStatus?: MCPStatus; question: string; setQuestion: (value: string) => void; ask: (event?: React.FormEvent) => void; chatBusy: boolean; analysisOpen: boolean; setAnalysisOpen: (value: boolean) => void; graphOpen: boolean; setGraphOpen: (value: boolean) => void; model: string; setModel: (value: string) => void; models: Model[]; reviewPanel: React.ReactNode}) {
  currentContractId=props.active.contract_id;
  const [tab,setTab]=useState('review');
  const [selectedAgent,setSelectedAgent]=useState('');
  useEffect(()=>{setTab('review');setSelectedAgent('');},[props.active.contract_id]);
  const view=props.analysisOpen?'checks':props.graphOpen?'graph':tab;
  const selectView=(value:string)=>{setTab(value);props.setAnalysisOpen(value==='checks');props.setGraphOpen(value==='graph');};
  const retrievalTrace=[...props.messages].reverse().find(message=>message.role==='assistant'&&message.retrieval_trace)?.retrieval_trace;
  const running=['running','queued'].includes(props.active.analysis_status);
  const tabs=[{id:'review',label:'Review report',icon:ShieldCheck},{id:'chat',label:'Contract chat',icon:MessageSquare},{id:'checks',label:'Evidence & checks',icon:ListChecks},{id:'graph',label:'Relationship graph',icon:Network},{id:'research',label:'Legal research',icon:BookOpen},{id:'agents',label:'Agent activity',icon:Activity}];
  return <section className="chat-column"><div className="workspace-breadcrumb">Workspace <span>/</span> Contract review</div><div className="chat-heading"><div className="chat-title"><span className="eyebrow">DOCUMENT WORKSPACE</span><h1 title={props.active.original_filename}>{props.active.original_filename.replace(/\.pdf$/i,'').replace(/_/g,' ')}</h1><div className="document-meta"><span><FileText size={16}/>{props.active.page_count||'—'} pages</span>{props.graph?.classification?.document_type&&<span>{props.graph.classification.document_type}</span>}<span className={'review-status '+(running?'is-running':props.active.analysis_status==='failed'?'is-failed':'')}>{running?<Activity size={15}/>:<CheckCircle2 size={15}/>} {running?'Review in progress':props.active.analysis_status==='complete'?'Review complete':props.active.analysis_status==='failed'?'Review needs attention':props.active.indexing_stage}</span>{props.active.selected_model===''&&props.active.analysis_status==='complete'&&<span className="review-status is-local"><Info size={15}/>Local rule review · limited analysis</span>}</div></div><PdfLink className="document-link" contractId={props.active.contract_id}><FileText size={18}/> Open original PDF</PdfLink></div><nav className="workspace-tabs" role="tablist" aria-label="Contract workspace sections">{tabs.map(({id,label,icon:Icon})=><button key={id} type="button" role="tab" aria-selected={view===id} aria-controls={`workspace-${id}`} id={`tab-${id}`} className={view===id?'is-selected':''} onClick={()=>selectView(id)}><Icon size={18}/>{label}</button>)}</nav><div className={'workspace-panel view-'+view} role="tabpanel" id={`workspace-${view}`} aria-labelledby={`tab-${view}`}>
    {view==='review'&&props.reviewPanel}
    {view==='checks'&&<><div className="section-heading"><span className="eyebrow">VERIFY THE DETAILS</span><h2>Evidence & document checks</h2><p>Compare the extracted signals with the original contract and inspect the sources behind chat answers.</p></div><EvidencePanel evidence={props.evidence} trace={retrievalTrace}/><AnalysisDetailsPanel graph={props.graph}/></>}
    {view==='graph'&&<><div className="section-heading"><span className="eyebrow">SEE THE CONNECTIONS</span><h2>Contract relationships</h2><p>Select an entity to explore its relationships and supporting document text. Scroll to zoom and drag to pan.</p></div><GraphPanel graph={props.graph}/></>}
    {view==='research'&&<><div className="section-heading"><span className="eyebrow">ADDITIONAL CONTEXT</span><h2>Official-source research</h2><p>Classification and government-source searches provide context alongside the contract. Follow the source links to verify the material.</p></div><MCPToolPanel graph={props.graph} telemetry={props.telemetry} serverStatus={props.mcpStatus} running={running}/></>}
    {view==='agents'&&<><div className="section-heading"><span className="eyebrow">REVIEW TRANSPARENCY</span><h2>Agent activity</h2><p>See what each review step does, what it found, and whether anything needs attention.</p></div><AgentActivityDashboard telemetry={props.telemetry} running={running} selectedAgent={selectedAgent} onSelectAgent={setSelectedAgent}/></>}
    {view==='chat'&&<div className="conversation"><div className="section-heading"><span className="eyebrow">ASK YOUR CONTRACT</span><h2>From legal language to clear answers</h2><p>Ask about responsibilities, key terms, or review points. Answers use the documents selected in your library.</p></div><div className="messages">{!props.ready?<div className="chat-empty"><h2>Preparing your contract</h2><p>{props.active.indexing_stage} · {props.active.indexing_progress}% complete.</p></div>:props.messages.length===0?<EmptyChat onSuggest={props.setQuestion}/>:props.messages.map((message,index)=><div className={'message '+message.role} key={index}><div className="avatar">{message.role==='user'?'You':<ShieldCheck size={20}/>}</div><div className="message-body"><span className="message-label">{message.role==='user'?'You':'Contract assistant'}</span><ReactMarkdown components={{a:({href,children})=><a href={href} target="_blank" rel="noreferrer">{children}</a>}}>{message.content}</ReactMarkdown>{message.citations?.length?<button className="source-link" onClick={()=>selectView('checks')}><FileText size={16}/>{message.citations.length} supporting source{message.citations.length===1?'':'s'}</button>:null}</div></div>)}{props.chatBusy&&<div className="typing"><Activity size={18}/>Checking the contract evidence…</div>}</div><form className="composer" onSubmit={props.ask}><div className="composer-top"><input disabled={!props.ready} value={props.question} onChange={event=>props.setQuestion(event.target.value)} placeholder="Ask a question about your contract…" aria-label="Your contract question"/><button disabled={!props.ready||props.chatBusy} aria-label="Send message"><Send size={20}/></button></div><div className="composer-meta"><span><ShieldCheck size={15}/>Grounded in your selected documents</span><label>Chat model<select value={props.model} onChange={event=>props.setModel(event.target.value)}><option value="">Local fallback</option>{props.models.map(model=><option key={model.id} value={model.id}>{model.name} · {model.provider}</option>)}</select></label></div></form></div>}
  </div></section>;
}

function EvidencePanel({evidence, trace}: {evidence: Citation[]; trace?: RetrievalTrace}) { return <><div className="analysis-popover"><div className="analysis-title"><span><Sparkles size={15}/> Retrieved evidence</span><b>Top {Math.min(5, evidence.length)}</b></div>{evidence.slice(0, 5).map((item, index) => <div className="evidence-row" key={item.chunk_id}><span>{index + 1}</span><div><PdfLink contractId={item.chunk_id.split('_C')[0]} page={item.page}><b>Page {item.page}{item.clause ? ` · Clause ${item.clause}` : ''}</b></PdfLink><p>{item.quote}</p></div></div>)}</div>{trace && <div className="retrieval-trace"><strong>Retrieval trace</strong><span>Query: {trace.query || Object.values(trace.queries || {}).join(' · ')}</span><span>Candidate chunks: {(trace.candidate_chunk_ids || []).join(', ') || 'none'}</span><span>Answer chunks: {(trace.answer_chunk_ids || []).join(', ') || 'none'}</span><span>Graph facts: {trace.graph_facts || 'none connected to retrieved chunks'}</span></div>}</>; }

function AnalysisDetailsPanel({graph}: {graph?: ContractGraph}) {
  const signature=graph?.signature; const quality=graph?.document_quality; const coverage=graph?.coverage; const config=graph?.document_config; const template=graph?.template_review; const graphReview=graph?.graph_review; const classification=graph?.classification; const research=graph?.government_research;
  return <div className="analysis-popover review-details"><div className="analysis-title"><span><ShieldCheck size={15}/> Review findings & checks</span></div>{classification && <div className="classifier-review"><div className="analysis-title"><span><FileText size={14}/> Document classification</span><b>{classification.confidence || 'low'} confidence</b></div><strong>{classification.document_type || 'Other / unclear'}</strong><p>{classification.jurisdiction || 'Jurisdiction unknown'} · {classification.reasoning}</p>{classification.alternatives?.length ? <p>Other possibilities: {classification.alternatives.join(', ')}</p> : null}{classification.evidence && <small>Supporting contract text · p. {classification.evidence.page}: “{classification.evidence.quote}”</small>}</div>}{research && <div className="official-research"><div className="analysis-title"><span>Internet research · government sources</span><b>{research.status || 'unknown'}{research.as_of ? ` · ${research.as_of}` : ''}</b></div><p>{research.note}</p>{research.sources?.map((source,index)=><div className="official-source" key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.published_date && <small>{source.published_date}</small>}<span>{source.snippet}</span></div>)}</div>}<div className="analysis-signals"><div><small>Document quality</small><strong>{quality?.status || 'Pending'}</strong>{quality?.warnings?.[0] && <span>{quality.warnings[0]}</span>}</div><div><small>Clause coverage</small><strong>{coverage ? `${coverage.present?.length || 0} present · ${coverage.missing?.length || 0} gaps` : 'Pending'}</strong>{coverage?.missing?.length ? <span>Missing: {coverage.missing.join(', ')}</span> : null}</div><div><small>Signature text check</small><strong>{signature?.status === 'found' ? 'Signature language found' : signature?.status === 'not_found' ? 'No signature language found' : 'Pending'}</strong>{signature?.signatory_candidates?.length ? <span>Names to verify: {signature.signatory_candidates.join(', ')}</span> : null}{signature?.notes && <span>{signature.notes}</span>}</div><div><small>Deadlines & duties</small><strong>{graph ? `${graph.deadlines?.dates?.length || 0} date mentions · ${graph.obligations?.obligations?.length || 0} obligations` : 'Pending'}</strong>{graph?.obligations?.unassigned_count ? <span>{graph.obligations.unassigned_count} obligations have no clear actor</span> : null}</div><div className="config-signal"><small>Document configuration</small><strong>{config ? `${config.recommended_chunk_size}/${config.recommended_overlap} char chunks · ${config.embedding_batch_size} batch` : 'Pending'}</strong>{config && <span>{config.embedding_dimension}-dimension embeddings · {config.embedding_max_tokens} max tokens · retrieval {config.top_k_bm25}/{config.top_k_vector}/{config.top_k_rerank} · review batches up to {config.review_context_chars} chars</span>}</div></div>{template && <div className="template-review"><div className="analysis-title"><span><FileText size={14}/> Template review · India property deeds</span><b>{template.match_score == null ? 'NEEDS TEXT' : `${template.match_score}/100`}</b></div><p>{template.summary || 'Template comparison complete.'}</p>{template.detection_confidence==='low' && <p className="template-note">Type detection is uncertain. Candidate types: {(template.candidate_types || []).join(', ') || 'none'}. Confirm the deed type before relying on this checklist.</p>}{!!template.missing_clauses?.length && <div><strong>Clause gaps</strong><span>{template.missing_clauses.slice(0,5).map(clause=>clause.title).join(' · ')}{template.missing_clauses.length>5?' …':''}</span></div>}{!!template.red_flags?.length && <div className="template-flags"><strong>{template.red_flags.length} red flag{template.red_flags.length===1?'':'s'}</strong><span>{template.red_flags.slice(0,3).map(flag=>`${flag.title}: ${flag.evidence}`).join(' · ')}</span></div>}<small>Keyword checklist screen; confirm state-specific rules and review cited wording.</small></div>}{graphReview && <div className="graph-review-note"><strong>Graph reviewer</strong><span>{graphReview.issues?.length ? graphReview.issues.join(' ') : `No relationship issues found across ${graphReview.relationship_count || 0} links.`}</span></div>}</div>;
}

function MCPToolPanel({graph,telemetry,serverStatus,running}: {graph?: ContractGraph; telemetry: AgentTelemetry; serverStatus?: MCPStatus; running: boolean}) {
  const classification=graph?.classification;
  const research=graph?.government_research;
  const classifierAgent=telemetry.agents.ContractClassifierAgent;
  const researchAgent=telemetry.agents.GovernmentResearchAgent;
  const latest=(name: string)=>[...telemetry.events].reverse().find(event=>event.agent===name);
  const classifierState=classification ? 'Complete' : running ? 'Running' : classifierAgent?.last_status==='degraded' ? 'Needs attention' : 'Waiting for review';
  const researchState=research?.status==='complete' ? 'Complete' : research?.status==='no_official_results' ? 'No official matches' : research?.status==='not_configured' ? 'Needs Tavily key' : research?.status==='unavailable' ? 'Unavailable' : running ? 'Running' : 'Waiting for review';
  const stateClass=(state:string)=>state==='Complete'||state==='Ready to launch'||state==='Key configured'?'done':state==='Running'?'running':state==='Needs attention'||state==='Unavailable'||state==='Needs Tavily key'?'warn':'waiting';
  return <div className="analysis-popover mcp-dashboard">
    <div className="analysis-title"><span><Activity size={15}/> MCP tool activity</span><b>{serverStatus?.server_status==='ready'?'Server code ready':'MCP SDK unavailable'} · {serverStatus?.transport || 'stdio'}</b></div>
    <p className="mcp-intro">The MCP host launches this server over stdio. Tavily key: <strong className={stateClass(serverStatus?.internet_search_status==='configured'?'Key configured':'Needs Tavily key')}>{serverStatus?.internet_search_status==='configured'?'Configured':'Missing'}</strong></p>
    <section className="mcp-tool-card"><div className="mcp-tool-heading"><div><strong>classify_contract_document</strong><small>ContractClassifierAgent</small></div><span className={'mcp-state '+stateClass(classifierState)}>{classifierState}</span></div><p>Classifies the contract and supplies its likely type and jurisdiction to the review prompt.</p>{classification ? <div className="mcp-output"><b>Output</b><span>{classification.document_type} · {classification.confidence} confidence</span><span>Jurisdiction: {classification.jurisdiction || 'unknown'}</span>{classification.evidence && <small>Evidence · p. {classification.evidence.page}: “{classification.evidence.quote}”</small>}</div> : <small>{latest('ContractClassifierAgent')?.detail || classifierAgent?.last_detail || 'No classifier output has been saved for this contract yet.'}</small>}</section>
    <section className="mcp-tool-card"><div className="mcp-tool-heading"><div><strong>search_official_legal_sources</strong><small>GovernmentResearchAgent</small></div><span className={'mcp-state '+stateClass(researchState)}>{researchState}</span></div><p>Searches official government legal sites for rules related to the classified type. Results are added to the review as research context.</p>{research ? <div className="mcp-output"><b>Output · {research.as_of || 'date unavailable'}</b><span>Query: {research.query}</span><span>{research.note}</span>{research.sources?.length ? research.sources.map((source,index)=><div className="mcp-source" key={index}><a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.published_date && <small>{source.published_date}</small>}<span>{source.snippet}</span></div>) : <small>No source links returned.</small>}</div> : <small>{latest('GovernmentResearchAgent')?.detail || researchAgent?.last_detail || 'No government-search output has been saved for this contract yet.'}</small>}</section>
    <div className="mcp-pipeline-note"><strong>Pipeline contribution</strong><span>{research?.sources?.length ? `${research.sources.length} official-source result(s) were supplied as extra legal context. Contract findings still need contract-page evidence.` : 'Classification is passed to the contract review. Online results will appear here after a search runs.'}</span></div>
  </div>;
}

function forceGraphLayout(nodes: GraphNode[], edges: GraphEdge[]) {
  const width=1100, height=620, center={x:width/2,y:height/2};
  const points=new Map<string,{x:number;y:number;vx:number;vy:number}>();
  const ordered=[...nodes].sort((a,b)=>a.kind.localeCompare(b.kind)||a.label.localeCompare(b.label));
  ordered.forEach((node,index)=>{const angle=index*2.399963;const radius=65+Math.sqrt(index)*35;points.set(node.id,{x:center.x+Math.cos(angle)*radius,y:center.y+Math.sin(angle)*radius,vx:0,vy:0})});
  for(let step=0;step<260;step++){
    const force=new Map<string,{x:number;y:number}>();ordered.forEach(node=>force.set(node.id,{x:(center.x-points.get(node.id)!.x)*.004,y:(center.y-points.get(node.id)!.y)*.004}));
    for(let i=0;i<ordered.length;i++)for(let j=i+1;j<ordered.length;j++){
      const a=points.get(ordered[i].id)!,b=points.get(ordered[j].id)!;let dx=b.x-a.x,dy=b.y-a.y;let distance=Math.max(1,Math.hypot(dx,dy));
      const push=1100/(distance*distance)+Math.max(0,105-distance)*.018;const fx=dx/distance*push,fy=dy/distance*push;
      force.get(ordered[i].id)!.x-=fx;force.get(ordered[i].id)!.y-=fy;force.get(ordered[j].id)!.x+=fx;force.get(ordered[j].id)!.y+=fy;
    }
    for(const edge of edges){const a=points.get(edge.source),b=points.get(edge.target);if(!a||!b)continue;const dx=b.x-a.x,dy=b.y-a.y,distance=Math.max(1,Math.hypot(dx,dy));const pull=(distance-175)*.0018,fx=dx/distance*pull,fy=dy/distance*pull;force.get(edge.source)!.x+=fx;force.get(edge.source)!.y+=fy;force.get(edge.target)!.x-=fx;force.get(edge.target)!.y-=fy;}
    for(const node of ordered){const point=points.get(node.id)!,f=force.get(node.id)!;point.vx=(point.vx+f.x)*.78;point.vy=(point.vy+f.y)*.78;point.x=Math.max(72,Math.min(width-72,point.x+point.vx));point.y=Math.max(58,Math.min(height-58,point.y+point.vy));}
  }
  return Object.fromEntries([...points].map(([id,p])=>[id,{x:p.x,y:p.y}]));
}

function GraphPanel({graph}: {graph?: ContractGraph}) {
  const data=graph?.graph; const nodes=data?.nodes || []; const edges=data?.edges || [];
  const [selected,setSelected]=useState<GraphNode>(); const [zoom,setZoom]=useState(1); const [pan,setPan]=useState({x:0,y:0});
  const drag=useRef<{x:number;y:number;panX:number;panY:number}|null>(null);
  const positions=useMemo(()=>forceGraphLayout(nodes,edges),[nodes,edges]);
  const colors:Record<string,string>={document:'#294f46',chunk:'#8aa39a',clause:'#3c8c73',topic:'#c29442',party:'#6b78b4',date:'#a66a99',amount:'#b96854',obligation:'#ce704b',deliverable:'#427da1',term:'#9270a8'};
  const kinds=[...new Set(nodes.map(node=>node.kind))];
  const connected=selected?edges.filter(edge=>edge.source===selected.id||edge.target===selected.id):[];
  const wheel=(event:React.WheelEvent<SVGSVGElement>)=>{event.preventDefault();setZoom(value=>Math.max(.45,Math.min(2.8,value*(event.deltaY<0?1.12:.89))))};
  const startDrag=(event:React.PointerEvent<SVGSVGElement>)=>{drag.current={x:event.clientX,y:event.clientY,panX:pan.x,panY:pan.y};event.currentTarget.setPointerCapture(event.pointerId)};
  const moveDrag=(event:React.PointerEvent<SVGSVGElement>)=>{if(!drag.current)return;const box=event.currentTarget.getBoundingClientRect();setPan({x:drag.current.panX+(event.clientX-drag.current.x)*1100/box.width,y:drag.current.panY+(event.clientY-drag.current.y)*620/box.height})};
  const label=(value:string)=>value.length>26?`${value.slice(0,25)}…`:value;
  const method=data?.extraction?.method;
  return <div className="analysis-popover graph-panel"><div className="analysis-title"><span><Activity size={15}/> {data?.document_name || 'Contract'} · relationship graph</span><b>{nodes.length} entities · {edges.length} relations</b></div><div className="graph-toolbar"><span>{method==='whole-contract-model-evidence-checked'?`Whole-contract graph · ${data?.extraction?.model || 'selected model'}`:method==='local-fallback'?'Local fallback graph · model extraction unavailable':'Local-rule graph · choose a review model for named-entity extraction'}{data?.extraction?.warning&&<small className="graph-warning">{data.extraction.warning}</small>}</span>{nodes.length>0&&<div className="graph-controls"><button aria-label="Zoom out" title="Zoom out" onClick={()=>setZoom(value=>Math.max(.45,value/1.2))}><ZoomOut size={14}/></button><span>{Math.round(zoom*100)}%</span><button aria-label="Zoom in" title="Zoom in" onClick={()=>setZoom(value=>Math.min(2.8,value*1.2))}><ZoomIn size={14}/></button><button aria-label="Reset graph view" title="Reset view" onClick={()=>{setZoom(1);setPan({x:0,y:0})}}><Maximize2 size={14}/></button></div>}</div>{nodes.length>0?<><div className="graph-scroll"><svg className="contract-graph" viewBox="0 0 1100 620" onWheel={wheel} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={()=>{drag.current=null}} onPointerCancel={()=>{drag.current=null}} role="group" aria-label="Interactive contract entity relationship graph"><title>Drag to pan, scroll to zoom, and select an entity to inspect its evidence and relationships</title><g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>{edges.map((edge,index)=>{const from=positions[edge.source],to=positions[edge.target];if(!from||!to)return null;const emphasized=!selected||edge.source===selected.id||edge.target===selected.id;const color=emphasized?'#789c8a':'#d5e2db';return <g key={`${edge.source}-${edge.target}-${edge.relation}-${index}`} opacity={emphasized?1:.42}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="graph-edge" style={{stroke:color}}/><text x={(from.x+to.x)/2} y={(from.y+to.y)/2-6} className="graph-edge-label">{label(edge.relation.replaceAll('_',' ').toLowerCase())}</text></g>})}{nodes.map(node=>{const point=positions[node.id];const active=node.id===selected?.id;const radius=active?19:node.kind==='chunk'?8:13;return <g key={node.id} className={'graph-node '+(active?'selected':'')} tabIndex={0} role="button" aria-label={`${node.kind}: ${node.label}`} onPointerDown={event=>event.stopPropagation()} onClick={()=>setSelected(node)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();setSelected(node)}}}><title>{node.label}</title><circle cx={point.x} cy={point.y} r={radius} fill={colors[node.kind]||'#84948d'}/><text x={point.x} y={point.y+radius+17} textAnchor="middle" className="graph-node-label">{label(node.label)}</text></g>})}</g></svg></div><div className="graph-legend">{kinds.map(kind=><span key={kind}><i style={{background:colors[kind]||'#84948d'}}/>{data?.legend?.[kind]||kind}</span>)}</div>{selected&&<div className="graph-inspector"><div><strong>{selected.label}</strong><span>{data?.legend?.[selected.kind]||selected.kind} · {connected.length} linked relation{connected.length===1?'':'s'}</span></div>{connected.length>0?<ul>{connected.map((edge,index)=>{const other=nodes.find(node=>node.id===(edge.source===selected.id?edge.target:edge.source));return <li key={`${edge.source}-${edge.target}-${index}`}><b>{edge.relation.replaceAll('_',' ').toLowerCase()}</b><span>{edge.source===selected.id?'→':'←'} {other?.label||'Unknown entity'}</span>{(edge.evidence_sources||((edge.page&&edge.evidence)?[{chunk_id:edge.chunk_id||'',page:edge.page,quote:edge.evidence}]:[])).map((proof,proofIndex)=><small key={`${proof.chunk_id}-${proofIndex}`}>Page {proof.page}: {proof.quote} <PdfLink contractId={currentContractId} page={proof.page}>Open evidence</PdfLink></small>)}</li>})}</ul>:selected.evidence?.map((proof,index)=><p className="graph-proof" key={`${proof.chunk_id}-${index}`}>Page {proof.page}: “{proof.quote}” <PdfLink contractId={currentContractId} page={proof.page}>Open source</PdfLink></p>)}</div>}</>:<div className="graph-empty"><Activity size={20}/><p>{data?.extraction?.warning||'No evidence-backed entities or relationships were extracted for this contract.'}</p></div>}</div>;
}

function AgentActivityDashboard({telemetry, running, selectedAgent, onSelectAgent}: {telemetry: AgentTelemetry; running: boolean; selectedAgent: string; onSelectAgent: (name: string) => void}) {
  const names=Object.keys(telemetry.agents);
  const latest=[...telemetry.events].reverse().slice(0,8);
  const chosen=selectedAgent || names[0] || '';
  const item=chosen ? telemetry.agents[chosen] : undefined;
  const latestForAgent=[...telemetry.events].reverse().find(event => event.agent===chosen);
  return <div className="analysis-popover agent-panel"><div className="analysis-title"><span><Activity size={15}/> Agent activity</span><b className={running ? 'live-badge' : ''}>{running ? 'LIVE' : 'LATEST RUN'}</b></div><div className="master-health"><CheckCircle2 size={13}/> Master supervisor: {telemetry.master?.status || 'unknown'} · {telemetry.master?.supervises || names.length} agents monitored</div><div className="agent-grid">{names.length ? names.map(name => { const agent=telemetry.agents[name]; const failed=agent.last_status==='degraded'||agent.failures>0; const status=failed?'Needs attention':agent.last_status==='waiting'?'Waiting':agent.last_status==='healthy'?'Complete':agent.last_status; return <button type="button" className={'agent-card '+(chosen===name?'active':'')} key={name} onClick={() => onSelectAgent(name)} aria-pressed={chosen===name}><span className="agent-card-title">{failed ? <AlertTriangle size={13}/> : <CheckCircle2 size={13}/>}<strong>{name}</strong><span>{status}</span></span><small>{agent.runs} runs · {agent.retries} retries · {agent.failures} failures</small></button>; }) : <p className="muted">Agents will appear here when analysis starts.</p>}</div>{item && <div className="agent-selected"><div><strong>{chosen}</strong><span>{item.last_status==='waiting'?'Waiting to run':item.last_status==='degraded'?'Needs attention':'Status: '+item.last_status}</span></div><p>{item.contribution || 'Supervised review task.'}</p><p>{latestForAgent?.detail || item.last_detail || 'Waiting for output.'}</p>{latestForAgent?.error && <p className="agent-error">{latestForAgent.error}</p>}</div>}<div className="agent-log"><div className="agent-log-head"><span>Recent activity</span><RotateCcw size={12}/></div>{latest.length ? latest.map((event,index) => <div className="agent-log-row" key={`${event.timestamp}-${index}`}><span className={'log-dot '+(event.action==='failed'?'failed':event.action==='retry'?'retry':'done')}/><div><strong>{event.agent}</strong><small>{event.action}{event.attempt?` · attempt ${event.attempt}`:''}{event.duration_ms?` · ${event.duration_ms} ms`:''}</small><p className="agent-event-detail">{event.detail || event.contribution || event.error || ''}</p></div></div>) : <p className="muted">Waiting for the first agent event…</p>}</div></div>;
}
function EmptyChat({onSuggest}: {onSuggest: (value: string) => void}) {
  return <div className="chat-empty"><span className="empty-icon"><MessageSquare size={28}/></span><h3>What would you like to understand?</h3><p>Start with a question below, or ask about any clause in your contract.</p><div className="suggestions"><button onClick={()=>onSuggest('Summarize this contract in plain language.')}><FileText size={18}/>Summarize this contract</button><button onClick={()=>onSuggest('What are the most important issues I should review first?')}><ShieldCheck size={18}/>Explain the review points</button><button onClick={()=>onSuggest('Who has to do what, and by when?')}><ListChecks size={18}/>Explain duties & deadlines</button></div></div>;
}

function ReportRail({findings, counts, score, scoreRationale, graph, busy, analysisStatus, analysisProgress, analysisStage, perspective, hasBothPerspectives, onPerspectiveChange, onOpenAnalysis, onRetry}: {findings: Finding[]; counts: {high: number; medium: number; low: number}; score?: number | null; scoreRationale?: string; graph?: ContractGraph; busy: boolean; analysisStatus: string; analysisProgress: number; analysisStage: string; perspective: string; hasBothPerspectives: boolean; onPerspectiveChange: (value: string) => void; onOpenAnalysis: () => void; onRetry: () => void}) {
  const analyzing=['running','queued'].includes(analysisStatus);
  const template=graph?.template_review;
  const isGift=template?.detected_type==='gift_deed'||graph?.classification?.document_type?.toLowerCase().includes('gift');
  const scoreMessage=score!=null?(scoreRationale||'Based on identified risks and generic protection checks.'):analyzing?'The score will appear when review is complete.':analysisStatus==='failed'?analysisStage:'No review score is available yet.';
  const scoreClass=score==null?'':score>=75?'score-strong':score>=50?'score-review':'score-attention';
  return <section className="report-rail"><div className="report-overview"><div className="report-intro"><span className="eyebrow">YOUR CONTRACT AT A GLANCE</span><h2>A clearer view of what matters.</h2><p>Review the concerns for each party, understand the suggested next steps, and check the original wording.</p></div><div className={'score-card '+scoreClass}><div><span>Automated review score</span><strong>{score==null?'Review pending':score>=75?'Fewer flagged concerns':'Review recommended'}</strong></div><span className="report-score">{score==null?'—':score}<small>/100</small></span></div></div><div className="perspective-control"><div><strong>Whose perspective?</strong><p>{isGift?'Compare the person giving the property with the person receiving it.':'Different terms can create different concerns for each party.'}</p></div><div role="tablist" aria-label="Choose contract review perspective"><button role="tab" type="button" aria-selected={perspective==='contract_giver'} className={perspective==='contract_giver'?'selected':''} disabled={busy||analyzing} onClick={()=>onPerspectiveChange('contract_giver')}>{isGift?'Donor · giver':'Contract giver'}</button><button role="tab" type="button" aria-selected={perspective==='contract_acceptor'} className={perspective==='contract_acceptor'?'selected':''} disabled={busy||analyzing} onClick={()=>onPerspectiveChange('contract_acceptor')}>{isGift?'Donee · receiver':'Contract acceptor'}</button></div></div>{!hasBothPerspectives&&!analyzing&&<p className="muted">Complete a review to compare both perspectives.</p>}{(busy||analyzing)&&<div className="analysis-progress" role="status"><div><Activity size={20}/><strong>{analysisStage||'Starting review'}</strong><span>{analysisProgress||0}%</span></div><div className="progress-track"><i style={{width:`${Math.max(4,analysisProgress||0)}%`}}/></div><p>The review runs automatically. You can keep this workspace open while it finishes.</p></div>}{score==null&&!analyzing&&<button className="primary retry-review" onClick={onRetry} disabled={busy}><RotateCcw size={18}/>{analysisStatus==='failed'||analysisStatus==='complete'?'Retry contract review':'Start contract review'}</button>}<div className="risk-strip"><div><span className="risk-stat-icon high-text"><AlertTriangle size={22}/></span><div><strong className="high-text">{counts.high}</strong><small>High & critical</small></div><span>Check these first</span></div><div><span className="risk-stat-icon medium-text"><Info size={22}/></span><div><strong className="medium-text">{counts.medium}</strong><small>Medium priority</small></div><span>Review the details</span></div><div><span className="risk-stat-icon low-text"><CheckCircle2 size={22}/></span><div><strong className="low-text">{counts.low}</strong><small>Lower priority</small></div><span>Keep these in view</span></div></div><div className="report-summary-grid"><section className="report-guide"><div className="card-heading"><BookOpen size={20}/><h3>How to read your report</h3></div><p>The review score combines flagged risks and generic protection checks. Higher scores mean fewer flagged concerns for the selected party.</p><p>Each finding shows the concern, a suggested next step, and source text. A checklist gap may not apply to your deed; verify the wording before treating it as a defect.</p><details className="score-details"><summary>See the score calculation</summary><p>{scoreMessage}</p></details></section>{template?<section className="report-template"><div className="card-heading"><ListChecks size={20}/><h3>Document checklist</h3><b>{template.match_score==null?'—':`${template.match_score}/100`}</b></div><p className="template-name">{template.detected_type_name||template.summary}</p><div className="template-meta"><span>{(template.missing_clauses||[]).length} checklist gaps</span><span>{(template.red_flags||[]).length} red flags</span></div><p className="template-score-note">This checks expected clauses and structure. It measures something different from the review score.</p>{template.detection_confidence==='low'&&<p className="analysis-error">Document type is uncertain. Confirm it before relying on the checklist.</p>}<button onClick={onOpenAnalysis}><ListChecks size={16}/>View checklist details</button></section>:<section className="report-template"><div className="card-heading"><ListChecks size={20}/><h3>Document checklist</h3></div><p>Checklist results will appear after your document has been reviewed.</p></section>}</div><div className="findings-heading"><div><span className="eyebrow">REVIEW PRIORITIES</span><h3>Findings to review <span>{findings.length}</span></h3></div><p>{perspective==='contract_giver'?(isGift?'From the donor’s perspective':'From the contract giver’s perspective'):(isGift?'From the donee’s perspective':'From the contract acceptor’s perspective')}</p></div><div className="findings-list">{findings.map(finding=><article className="risk-item" key={finding.finding_id}><div className="risk-item-head"><span className={'severity-badge '+finding.severity.toLowerCase()}>{finding.severity}</span><span className="finding-category">{finding.category.replaceAll('_',' ')}</span></div><h3>{finding.claim}</h3><div className="finding-action"><span><CheckCircle2 size={18}/></span><p><b>Suggested next step</b>{finding.recommendation}</p></div><details className="finding-explanation"><summary>Why this was flagged & source</summary>{finding.reasoning&&<p>{finding.reasoning}</p>}{finding.evidence?.map((proof,index)=><blockquote key={`${proof.chunk_id}-${index}`}><p>“{proof.quote}”</p><PdfLink contractId={proof.chunk_id.split('_C')[0]} page={proof.page}><FileText size={16}/>Open source · page {proof.page}</PdfLink></blockquote>)}</details></article>)}</div>{!findings.length&&<div className="report-empty"><ShieldCheck size={32}/><h3>{analyzing?'Your review is on its way':score!=null?'No clause-level findings to show':'Ready when you are'}</h3><p>{analyzing?'Findings and source evidence will appear here when the analysis finishes.':score!=null?'Check the document checklist and original text for additional context.':'Upload a contract or start its review to see the results here.'}</p></div>}<div className="autonomous-note"><ShieldCheck size={18}/><span>AI-assisted review for understanding and prioritising issues. Check the cited text; the score does not certify legal validity.</span></div></section>;
}

createRoot(document.getElementById('root')!).render(<App/>);
