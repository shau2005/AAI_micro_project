import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/review-state.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {selectPerspective} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);

test('cached report with empty perspectives retains its saved giver score', () => {
  const report = {findings: [{claim: 'Check payment'}], summary: {score: 73}, perspective_reviews: {}};
  assert.equal(selectPerspective(report, 'contract_giver').summary.score, 73);
  assert.equal(selectPerspective(report, 'contract_giver').findings.length, 1);
});

test('the acceptor never receives the giver report as a substitute', () => {
  const report = {findings: [], summary: {score: 73}, perspective_reviews: {}};
  assert.equal(selectPerspective(report, 'contract_acceptor'), undefined);
});

test('saved party scores are selected independently', () => {
  const report = {findings: [], summary: {score: 73}, perspective_reviews: {
    contract_giver: {findings: [], summary: {score: 73}},
    contract_acceptor: {findings: [], summary: {score: 78}},
  }};
  assert.equal(selectPerspective(report, 'contract_acceptor').summary.score, 78);
});

test('a valid party report with zero findings is preserved', () => {
  const report = {findings: [{claim: 'Old finding'}], summary: {score: 50}, perspective_reviews: {
    contract_giver: {findings: [], summary: {score: 100}},
  }};
  assert.deepEqual(selectPerspective(report, 'contract_giver').findings, []);
  assert.equal(selectPerspective(report, 'contract_giver').summary.score, 100);
});
