export type GraphProof = {chunk_id?: string; page: number; quote: string};
export type GraphEntity = {id: string; label: string; kind: string; evidence?: GraphProof[]};
export type GraphRelationship = {source: string; target: string; relation: string; evidence_sources?: GraphProof[]; chunk_id?: string; page?: number; evidence?: string};
export type RelationshipGraph = {nodes: GraphEntity[]; edges: GraphRelationship[]; document_name?: string; extraction?: {method?: string; model?: string; warning?: string}};
export type Connection = {index: number; edge: GraphRelationship; source: GraphEntity; target: GraphEntity; other: GraphEntity; outgoing: boolean};

export function graphConnections(nodes: GraphEntity[], edges: GraphRelationship[], selectedId?: string): Connection[] {
  const byId = new Map(nodes.map(node => [node.id, node]));
  return edges.flatMap((edge, index) => {
    const source = byId.get(edge.source), target = byId.get(edge.target);
    if (!source || !target || (selectedId && edge.source !== selectedId && edge.target !== selectedId)) return [];
    const outgoing = !selectedId || edge.source === selectedId;
    return [{index, edge, source, target, outgoing, other: outgoing ? target : source}];
  });
}

export function defaultGraphEntity(nodes: GraphEntity[], edges: GraphRelationship[]): GraphEntity | undefined {
  const degrees = new Map<string, number>();
  for (const connection of graphConnections(nodes, edges)) {
    degrees.set(connection.edge.source, (degrees.get(connection.edge.source) || 0) + 1);
    degrees.set(connection.edge.target, (degrees.get(connection.edge.target) || 0) + 1);
  }
  return [...nodes].sort((a,b) => (degrees.get(b.id) || 0) - (degrees.get(a.id) || 0)
    || Number(b.kind === 'party') - Number(a.kind === 'party') || a.label.localeCompare(b.label))[0];
}

export function relationshipLabel(value: string): string {
  const text = value.replaceAll('_', ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  return text ? text[0].toUpperCase() + text.slice(1) : 'Related to';
}

export function relationshipEvidence(edge: GraphRelationship): GraphProof[] {
  const proofs = edge.evidence_sources?.length ? edge.evidence_sources
    : edge.page && edge.evidence ? [{chunk_id: edge.chunk_id, page: edge.page, quote: edge.evidence}] : [];
  const seen = new Set<string>();
  return proofs.filter(proof => {
    if (!proof.quote?.trim() || !Number.isFinite(proof.page) || proof.page < 1) return false;
    const key = `${proof.page}:${proof.quote}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

// Pixel-sized HTML cards keep labels readable; each connection has its own row.
export function connectionLayout(selected: GraphEntity, connections: Connection[]) {
  const cardHeight = (label: string) => 100 + Math.max(1, Math.ceil(label.length / 20)) * 28;
  const focusHeight = cardHeight(selected.label);
  let cursor = 24;
  const rows = connections.map(connection => {
    const height = Math.max(cardHeight(connection.other.label), 58 + Math.ceil(connection.edge.relation.length / 22) * 20);
    const row = {connection, y: cursor, height, center: cursor + height / 2};
    cursor += height + 28;
    return row;
  });
  const height = Math.max(320, cursor, focusHeight + 72);
  return {width: 880, height, focusY: (height - focusHeight) / 2, focusHeight, center: height / 2, rows};
}
