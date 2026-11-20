import React, {useId, useMemo, useRef, useState} from 'react';
import {Activity, ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, FileText, List, Maximize2, Network, Search, ZoomIn, ZoomOut} from 'lucide-react';
import {PdfLink} from './PdfLinks';
import {connectionLayout, defaultGraphEntity, graphConnections, relationshipEvidence, relationshipLabel, type GraphEntity, type RelationshipGraph} from './graph-view';

const PAGE_SIZE = 4;
const kinds: Record<string,string> = {party: 'Person / organisation', amount: 'Amount', date: 'Date', term: 'Contract term', clause: 'Clause', document: 'Document', obligation: 'Duty', topic: 'Topic', deliverable: 'Deliverable', chunk: 'Source passage'};
function kindLabel(kind: string) { return kinds[kind] || relationshipLabel(kind); }
function EntityLabel({node}: {node: GraphEntity}) {
  return <><span className={'entity-kind kind-'+node.kind}>{kindLabel(node.kind)}</span><strong>{node.label}</strong></>;
}

export function GraphExplorer({graph, contractId}: {graph?: RelationshipGraph; contractId: string}) {
  const nodes = graph?.nodes || [], edges = graph?.edges || [];
  const [selectedId, setSelectedId] = useState<string>();
  const [edgeIndex, setEdgeIndex] = useState<number>();
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'map'|'list'>('map');
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState(1);
  const viewport = useRef<HTMLDivElement>(null);
  const dragging = useRef<{x:number; y:number; left:number; top:number} | null>(null);
  const markerId = useId().replaceAll(':','');
  const selected = nodes.find(node => node.id === selectedId) || defaultGraphEntity(nodes, edges);
  const connections = useMemo(() => graphConnections(nodes, edges, selected?.id), [nodes, edges, selected?.id]);
  const allConnections = useMemo(() => graphConnections(nodes, edges), [nodes, edges]);
  const safePage = Math.min(page, Math.max(0, Math.ceil(connections.length / PAGE_SIZE) - 1));
  const visible = connections.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);
  const layout = selected ? connectionLayout(selected, visible) : undefined;
  const matchingNodes = nodes.filter(node => `${node.label} ${kindLabel(node.kind)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const matchingConnections = allConnections.filter(connection => `${connection.source.label} ${connection.target.label} ${relationshipLabel(connection.edge.relation)}`.toLowerCase().includes(query.trim().toLowerCase()));
  const currentConnection = connections.find(connection => connection.index === edgeIndex) || visible[0];
  const proofs = currentConnection ? relationshipEvidence(currentConnection.edge) : selected?.evidence || [];
  const focus = (id: string) => { setSelectedId(id); setEdgeIndex(undefined); setPage(0); if (viewport.current) viewport.current.scrollTo(0,0); };
  const reset = () => { setZoom(1); if (viewport.current) viewport.current.scrollTo(0,0); };
  const startDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'mouse' || (event.target as Element).closest('button,a,input,select') || !viewport.current) return;
    dragging.current = {x:event.clientX,y:event.clientY,left:viewport.current.scrollLeft,top:viewport.current.scrollTop};
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !viewport.current) return;
    viewport.current.scrollLeft = dragging.current.left - (event.clientX - dragging.current.x);
    viewport.current.scrollTop = dragging.current.top - (event.clientY - dragging.current.y);
  };
  const method = graph?.extraction?.method;
  return <section className="graph-explorer" aria-label="Contract relationship explorer">
    <header className="graph-explorer-header"><div><span className="eyebrow">RELATIONSHIP EXPLORER</span><h3>See who connects to what.</h3><p>Select an entity to follow its connections. Select a connection to read the exact source.</p></div><div className="graph-total"><strong>{nodes.length}</strong><span>entities</span><i/><strong>{allConnections.length}</strong><span>relationships</span></div></header>
    {!nodes.length?<div className="graph-empty"><Network size={26}/><div><strong>Your relationship map will appear here.</strong><p>Open Review report and select Re-run contract review to build it.</p></div></div>:<>
      <div className="graph-browse-toolbar"><label className="graph-search"><Search size={18}/><input aria-label="Find an entity or relationship" placeholder="Search names, amounts, or relationships…" value={query} onChange={event=>setQuery(event.target.value)}/></label><div className="graph-view-switch" role="group" aria-label="Relationship display"><button type="button" aria-pressed={mode==='map'} onClick={()=>setMode('map')}><Network size={17}/>Focus map</button><button type="button" aria-pressed={mode==='list'} onClick={()=>setMode('list')}><List size={17}/>All relationships</button></div></div>
      {mode==='map'&&<><div className="graph-entity-picker" aria-label="Choose an entity">{matchingNodes.map(node=><button type="button" key={node.id} aria-pressed={selected?.id===node.id} onClick={()=>focus(node.id)}><span className={'entity-dot kind-'+node.kind}/><span>{node.label}</span></button>)}{!matchingNodes.length&&<p>No entities match your search. Try another name or amount.</p>}</div>
        {selected&&layout&&<><div className="graph-focus-heading"><div><span>FOCUSING ON</span><h4>{selected.label}</h4><p>{connections.length} direct connection{connections.length===1?'':'s'} · Arrows show the direction of each relationship.</p></div><div className="graph-readable-controls"><button type="button" aria-label="Zoom out" disabled={zoom<=.75} onClick={()=>setZoom(value=>Math.max(.75,value-.1))}><ZoomOut size={18}/></button><output aria-label="Graph zoom">{Math.round(zoom*100)}%</output><button type="button" aria-label="Zoom in" disabled={zoom>=1.5} onClick={()=>setZoom(value=>Math.min(1.5,value+.1))}><ZoomIn size={18}/></button><button type="button" aria-label="Reset graph view" onClick={reset}><Maximize2 size={18}/></button></div></div>
          {connections.length>0?<><div ref={viewport} className="graph-readable-viewport" tabIndex={0} aria-label="Relationship map. Scroll or drag the background to explore." onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={()=>{dragging.current=null;}} onPointerCancel={()=>{dragging.current=null;}}><div className="graph-canvas-size" style={{width:layout.width*zoom,height:layout.height*zoom}}><div className="graph-readable-canvas" style={{width:layout.width,height:layout.height,transform:`scale(${zoom})`}}>
            <svg className="graph-connectors" width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8Z" fill="context-stroke"/></marker></defs>{layout.rows.map(row=>{const active=currentConnection?.index===row.connection.index;const path=row.connection.outgoing?`M248 ${layout.center} H288 V${row.center} H598`:`M600 ${row.center} H288 V${layout.center} H250`;return <path key={row.connection.index} d={path} className={active?'is-active':''} markerEnd={`url(#${markerId})`}/>;})}</svg>
            <div className="graph-entity-card is-focus" style={{left:24,top:layout.focusY,width:224,minHeight:layout.focusHeight}}><EntityLabel node={selected}/><span className="graph-card-caption">Selected entity</span></div>
            {layout.rows.map(row=><React.Fragment key={row.connection.index}><button type="button" className={'graph-relation-label '+(currentConnection?.index===row.connection.index?'is-active':'')} style={{left:320,top:row.center-30,width:236,minHeight:60}} aria-pressed={currentConnection?.index===row.connection.index} onClick={()=>setEdgeIndex(row.connection.index)} aria-label={`${row.connection.source.label} ${relationshipLabel(row.connection.edge.relation)} ${row.connection.target.label}. Show source.`}>{row.connection.outgoing?<ArrowRight size={18}/>:<ArrowLeft size={18}/>}<span>{relationshipLabel(row.connection.edge.relation)}</span></button><button type="button" className="graph-entity-card" style={{left:602,top:row.y,width:252,minHeight:row.height}} onClick={()=>focus(row.connection.other.id)} aria-label={`Focus on ${row.connection.other.label}`}><EntityLabel node={row.connection.other}/><span className="graph-card-caption">Explore connections <ChevronRight size={14}/></span></button></React.Fragment>)}
          </div></div></div><div className="graph-mobile-connections">{visible.map(connection=><button type="button" className="graph-mobile-connection" key={connection.index} onClick={()=>setEdgeIndex(connection.index)} aria-pressed={currentConnection?.index===connection.index}><strong>{connection.source.label}</strong><span><ArrowRight size={17}/>{relationshipLabel(connection.edge.relation)}</span><strong>{connection.target.label}</strong></button>)}</div><div className="graph-map-footer"><span>Showing {safePage*PAGE_SIZE+1}–{Math.min((safePage+1)*PAGE_SIZE,connections.length)} of {connections.length} connections. <span className="graph-desktop-hint">Drag the background or scroll to explore.</span></span>{connections.length>PAGE_SIZE&&<div><button type="button" aria-label="Previous connections" disabled={safePage===0} onClick={()=>{setPage(safePage-1);setEdgeIndex(undefined);reset();}}><ChevronLeft size={18}/></button><span>{safePage+1} / {Math.ceil(connections.length/PAGE_SIZE)}</span><button type="button" aria-label="Next connections" disabled={(safePage+1)*PAGE_SIZE>=connections.length} onClick={()=>{setPage(safePage+1);setEdgeIndex(undefined);reset();}}><ChevronRight size={18}/></button></div>}</div></>:<div className="graph-unconnected"><Network size={24}/><p>No relationships were saved for this entity. Its source evidence is shown below when available. Choose another entity to continue.</p></div>}
        </>}
      </>}
      {mode==='list'&&<div className="graph-all-connections"><p>{matchingConnections.length} relationship{matchingConnections.length===1?'':'s'}{query?' matching your search':''}. Select a row to inspect its source.</p>{matchingConnections.map(connection=><button type="button" className={'graph-relationship-row '+(currentConnection?.index===connection.index?'is-active':'')} key={connection.index} onClick={()=>{focus(connection.source.id);setEdgeIndex(connection.index);setPage(Math.floor(graphConnections(nodes,edges,connection.source.id).findIndex(item=>item.index===connection.index)/PAGE_SIZE));}}><span><small>{kindLabel(connection.source.kind)}</small><strong>{connection.source.label}</strong></span><span className="graph-row-relation"><ArrowRight size={18}/>{relationshipLabel(connection.edge.relation)}</span><span><small>{kindLabel(connection.target.kind)}</small><strong>{connection.target.label}</strong></span><FileText size={18}/></button>)}{!matchingConnections.length&&<p>No relationships match. Clear your search to see all saved connections.</p>}</div>}
      <aside className="graph-source-panel" aria-label="Relationship source evidence"><div className="graph-source-heading"><FileText size={19}/><h4>{currentConnection?'Why these entities are connected':'Source for this entity'}</h4></div>{currentConnection&&<p className="graph-source-statement"><strong>{currentConnection.source.label}</strong> <span>{relationshipLabel(currentConnection.edge.relation).toLowerCase()}</span> <strong>{currentConnection.target.label}</strong></p>}{proofs.length?proofs.map((proof,index)=><blockquote key={`${proof.page}-${index}`}><span>CONTRACT SOURCE · PAGE {proof.page}</span><p>“{proof.quote}”</p><PdfLink contractId={contractId} page={proof.page}>Open original · page {proof.page}<ArrowRight size={15}/></PdfLink></blockquote>):<p className="graph-source-empty">No source passage was saved for this selection. Check the original contract before relying on the relationship.</p>}</aside>
    </>}
    <footer className="graph-extraction-note"><Activity size={16}/><span>{method==='whole-contract-model-evidence-checked'?'Extracted with the review model and linked to contract evidence.':method==='local-fallback'?'Built with local rules after model extraction was unavailable.':'Built from local contract-text rules.'} {graph?.extraction?.warning&&'Review the source passages carefully.'} The map shows saved connections; it does not establish legal validity.</span></footer>
  </section>;
}
