import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/graph-view.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {graphConnections, defaultGraphEntity, connectionLayout, relationshipEvidence, relationshipLabel} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const nodes = [{id:'seller',label:'Seller',kind:'party'}, {id:'buyer',label:'Buyer',kind:'party'}, {id:'price',label:'Rs. 48,00,000',kind:'amount'}, {id:'unconnected',label:'Additional clause',kind:'clause'}];
const edges = [{source:'seller',target:'buyer',relation:'TRANSFERS_TO'}, {source:'buyer',target:'price',relation:'PAYS'}];

test('focusing a node preserves incoming and outgoing relationship directions', () => {
 const links = graphConnections(nodes, edges, 'buyer');
 assert.equal(links.length, 2);
 assert.equal(links[0].outgoing, false);
 assert.equal(links[0].source.id, 'seller'); assert.equal(links[0].target.id, 'buyer');
 assert.equal(links[0].other.id, 'seller');
 assert.equal(links[1].outgoing, true); assert.equal(links[1].other.id, 'price');
});

test('all-relationships view excludes dangling endpoints while retaining every valid relationship', () => {
 const links = graphConnections(nodes,[...edges,{source:'missing',target:'buyer',relation:'INVALID'}]);
 assert.equal(links.length, 2);
 assert.deepEqual(links.map(link=>link.index), [0,1]);
});

test('the initial focus is the most connected entity rather than an isolated node', () => {
 assert.equal(defaultGraphEntity(nodes,edges).id, 'buyer');
 assert.equal(defaultGraphEntity([],[]), undefined);
});

test('long labels receive separate rows with space for cards and relationship captions', () => {
 const longNodes = [nodes[1], ...Array.from({length:4}, (_,index)=>({id:`long-${index}`,label:`A very long contract entity name with several additional identifying words ${index}`,kind:'term'}))];
 const longEdges = longNodes.slice(1).map(node=>({source:'buyer',target:node.id,relation:'HAS_A_LONG_EXPLICIT_CONTRACTUAL_RELATIONSHIP_WITH'}));
 const layout = connectionLayout(nodes[1],graphConnections(longNodes,longEdges,'buyer'));
 for (let i=0;i<layout.rows.length;i++) {
  const row = layout.rows[i];
  assert.ok(row.y>=0 && row.y+row.height<=layout.height);
  assert.ok(row.height>=180);
  if (i) assert.ok(row.y > layout.rows[i-1].y+layout.rows[i-1].height);
 }
 assert.ok(layout.focusY>=0 && layout.focusY+layout.focusHeight<=layout.height);
});

test('source evidence supports both current and legacy graph formats without duplicates', () => {
 const proof={page:2,quote:'The buyer shall pay the seller.',chunk_id:'doc_C0001'};
 assert.deepEqual(relationshipEvidence({...edges[0],evidence_sources:[proof,proof,{page:0,quote:'invalid'}]}),[proof]);
 assert.deepEqual(relationshipEvidence({...edges[0],page:2,evidence:proof.quote,chunk_id:proof.chunk_id}),[proof]);
 assert.deepEqual(relationshipEvidence(edges[0]),[]);
});

test('relationship labels remain faithful to the stored relation', () => {
 assert.equal(relationshipLabel('PAID_BY'),'Paid by');
 assert.equal(relationshipLabel('TRANSFERS_TO'),'Transfers to');
});
