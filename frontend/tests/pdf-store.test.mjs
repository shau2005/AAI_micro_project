import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';

const source = await readFile(new URL('../src/pdf-store.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {createPdfStore} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const pdf = () => new Response('%PDF-1.7 specimen', {headers: {'Content-Type': 'application/pdf'}});
const options = {apiBase: 'http://localhost:8000/api', workspaceId: 'non-default-workspace', createUrl: () => 'blob:test', revokeUrl: () => {}};

test('PDF requests carry the active workspace header', async () => {
  const store = createPdfStore({...options, fetchDocument: async (url, init) => {
    assert.equal(url, 'http://localhost:8000/api/contracts/contract%2F123/document');
    assert.equal(init.headers['X-Workspace-ID'], 'non-default-workspace');
    return pdf();
  }});
  assert.equal(await store.load('contract/123'), 'blob:test');
});

test('multiple links to a PDF share one request', async () => {
  let calls = 0;
  const store = createPdfStore({...options, fetchDocument: async () => { calls++; return pdf(); }});
  assert.deepEqual(await Promise.all([store.load('same'), store.load('same')]), ['blob:test', 'blob:test']);
  assert.equal(calls, 1);
});

test('PDFs are not reused between workspaces', async () => {
  const seen = [];
  const fetchDocument = async (_url, init) => { seen.push(init.headers['X-Workspace-ID']); return pdf(); };
  await createPdfStore({...options, workspaceId: 'first', fetchDocument}).load('same');
  await createPdfStore({...options, workspaceId: 'second', fetchDocument}).load('same');
  assert.deepEqual(seen, ['first', 'second']);
});

test('a denied PDF is not converted to an object URL and can be retried', async () => {
  let calls = 0;
  let created = 0;
  const store = createPdfStore({...options, createUrl: () => { created++; return 'blob:success'; },
    fetchDocument: async () => ++calls === 1 ? new Response('Not found', {status: 404}) : pdf()});
  await assert.rejects(store.load('private'), /current workspace/);
  assert.equal(created, 0);
  assert.equal(await store.load('private'), 'blob:success');
});

test('a JSON error returned with HTTP 200 is not opened as a PDF', async () => {
  const store = createPdfStore({...options, fetchDocument: async () => new Response('{}', {headers: {'Content-Type': 'application/json'}})});
  await assert.rejects(store.load('broken'), /did not return a PDF/);
});

test('closing the workspace releases PDF URLs', async () => {
  const revoked = [];
  const store = createPdfStore({...options, fetchDocument: async () => pdf(), revokeUrl: url => revoked.push(url)});
  await store.load('sample');
  store.dispose();
  assert.deepEqual(revoked, ['blob:test']);
  await assert.rejects(store.load('sample'), /closed/);
});

test('an in-flight request cannot create a URL after workspace disposal', async () => {
  let resolve;
  const store = createPdfStore({...options, fetchDocument: () => new Promise(done => { resolve = done; }),
    createUrl: () => { assert.fail('A closed workspace must not retain a PDF URL'); }});
  const pending = store.load('sample');
  store.dispose();
  resolve(pdf());
  await assert.rejects(pending, /closed/);
});
