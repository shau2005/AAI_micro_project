import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/finding-explanation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {explainFinding} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const finding = {
  severity: 'MEDIUM',
  claim: 'Vendor indemnification is limited to acts or omissions of the Vendor, potentially omitting third-party historical title defects.',
  reasoning: 'Restricting the indemnity to the Vendor’s own acts or omissions might exclude historical defects.',
  evidence: [{page: 1, chunk_id: 'sample_C0001', quote: 'The Vendor shall indemnify the Vendee against any defect in title, claim or loss arising from any act or omission of the Vendor.'}],
};

test('the screenshot finding explains the seller promise using everyday words', () => {
  const result = explainFinding(finding, 'contract_acceptor', 'sale deed');
  assert.match(result.simple, /seller promises/);
  assert.match(result.simple, /earlier owners/);
  assert.match(result.sourceExplanation, /quotation alone does not show/);
  assert.match(result.example, /not a claim that such a problem exists/);
  assert.equal(result.terms.find(term => term.term === 'Vendor').meaning, 'The seller.');
  assert.equal(result.terms.find(term => term.term === 'Vendee').meaning, 'The buyer.');
});

test('a saved severity label is not converted into an invented model rationale', () => {
  const result = explainFinding(finding, 'contract_acceptor');
  assert.match(result.severityReason, /does not record why/);
  assert.match(result.priorityMeaning, /Clarify/);
  assert.equal(result.severity, 'MEDIUM');
});

test('seller perspective warns when expanding indemnity benefits the buyer', () => {
  const seller = explainFinding(finding, 'contract_giver', 'sale deed');
  const buyer = explainFinding(finding, 'contract_acceptor', 'sale deed');
  assert.match(seller.perspectiveNote, /increase the seller’s responsibility/);
  assert.equal(buyer.perspectiveNote, '');
});

test('new model explanations and priority reasons remain distinct', () => {
  const result = explainFinding({...finding, simple_explanation: 'Meaning supplied by reviewer.', severity_reason: 'The outcome depends on the scope of the promise.', practical_example: 'A hypothetical example.', source_explanation: 'The quoted condition limits the promise.'}, 'contract_acceptor');
  assert.equal(result.simple, 'Meaning supplied by reviewer.');
  assert.equal(result.severityReason, 'The outcome depends on the scope of the promise.');
  assert.equal(result.example, 'A hypothetical example.');
  assert.equal(result.sourceExplanation, 'The quoted condition limits the promise.');
});

test('an unrelated finding does not receive the seller-title example', () => {
  const result = explainFinding({severity: 'LOW', claim: 'Check a payment date.', evidence: [{page: 1, chunk_id: 'sample_C0001', quote: 'Payment is due on 1 December.'}]}, 'contract_giver', 'sale deed');
  assert.equal(result.example, '');
  assert.equal(result.perspectiveNote, '');
  assert.equal(result.terms.length, 0);
});

test('unsupported priority values are shown as unknown without silently changing severity', () => {
  const result = explainFinding({severity: 'UNSPECIFIED', claim: 'Check the clause.'}, 'contract_giver');
  assert.match(result.priorityMeaning, /does not provide a recognised priority/);
  assert.equal(result.severity, 'UNSPECIFIED');
});
