import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const source = await readFile(new URL('../src/document-chat.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022}});
const {DocumentChatSessions} = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`);
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a; reject=b;}); return {promise, resolve, reject}; };
const message = content => ({role: 'assistant', content});

test('out-of-order history loads stay with their document', async () => {
  const sessions = new DocumentChatSessions();
  const a = deferred();
  const pending = sessions.load('A', () => a.promise);
  await sessions.load('B', async () => [message('B history')]);
  a.resolve([message('A history')]); await pending;
  assert.equal(sessions.get('A').messages[0].content, 'A history');
  assert.equal(sessions.get('B').messages[0].content, 'B history');
});

test('draft questions are independent for each document', () => {
  const sessions = new DocumentChatSessions();
  sessions.setDraft('A', 'Question A'); sessions.setDraft('B', 'Question B');
  assert.equal(sessions.get('A').draft, 'Question A');
  assert.equal(sessions.get('B').draft, 'Question B');
});

test('a delayed reply stays with its originating document after switching', async () => {
  const sessions = new DocumentChatSessions();
  await sessions.load('A', async () => []); await sessions.load('B', async () => []);
  sessions.setDraft('A', 'Question A');
  const a = deferred(); const pending = sessions.send('A', () => a.promise);
  sessions.setDraft('B', 'Question B');
  await sessions.send('B', async () => message('Answer B'));
  a.resolve(message('Answer A')); await pending;
  assert.deepEqual(sessions.get('A').messages.map(m => m.content), ['Question A', 'Answer A']);
  assert.deepEqual(sessions.get('B').messages.map(m => m.content), ['Question B', 'Answer B']);
});

test('pending requests block duplicate sends only for the same document', async () => {
  const sessions = new DocumentChatSessions(); await sessions.load('A', async () => []);
  sessions.setDraft('A', 'First question'); const a = deferred();
  const pending = sessions.send('A', () => a.promise);
  sessions.setDraft('A', 'Next draft'); let duplicate = false;
  await sessions.send('A', async () => {duplicate=true; return message('Duplicate');});
  assert.equal(duplicate, false); assert.equal(sessions.get('A').busy, true);
  assert.equal(sessions.get('B').busy, false);
  a.resolve(message('Answer')); await pending;
  assert.equal(sessions.get('A').draft, 'Next draft');
});

test('history failure permits retry and blocks sending without prior context', async () => {
  const sessions = new DocumentChatSessions();
  await sessions.load('A', async () => {throw Error('offline');});
  sessions.setDraft('A', 'Question'); let sent = false;
  await sessions.send('A', async () => {sent=true; return message('Answer');});
  assert.equal(sent, false); assert.ok(sessions.get('A').error);
  await sessions.load('A', async () => [message('Saved answer')]);
  assert.equal(sessions.get('A').loaded, true); assert.equal(sessions.get('A').error, '');
  assert.equal(sessions.get('A').draft, 'Question');
});

test('failed sending restores only the originating document draft', async () => {
  const sessions = new DocumentChatSessions(); await sessions.load('A', async () => []);
  sessions.setDraft('A', 'Question A'); sessions.setDraft('B', 'Question B');
  await sessions.send('A', async () => {throw Error('offline');});
  assert.equal(sessions.get('A').draft, 'Question A'); assert.ok(sessions.get('A').error);
  assert.equal(sessions.get('B').draft, 'Question B'); assert.equal(sessions.get('B').error, '');
});

test('deleting a document discards its conversation and a delayed history response', async () => {
  const sessions = new DocumentChatSessions();
  const oldHistory = deferred();
  const loading = sessions.load('A', () => oldHistory.promise);
  sessions.setDraft('A', 'Old draft');
  sessions.forget('A');
  await sessions.load('A', async () => []);
  oldHistory.resolve([message('Deleted history')]); await loading;
  assert.deepEqual(sessions.get('A').messages, []);
  assert.equal(sessions.get('A').draft, '');
  assert.equal(sessions.get('A').loaded, true);
});

test('a reply from a deleted document cannot enter its fresh upload conversation', async () => {
  const sessions = new DocumentChatSessions();
  await sessions.load('A', async () => []);
  await sessions.load('B', async () => [message('Keep B')]);
  sessions.setDraft('A', 'Old question'); const reply = deferred();
  const sending = sessions.send('A', () => reply.promise);
  sessions.forget('A');
  await sessions.load('A', async () => []);
  reply.resolve(message('Deleted answer')); await sending;
  assert.deepEqual(sessions.get('A').messages, []);
  assert.equal(sessions.get('A').busy, false);
  assert.deepEqual(sessions.get('B').messages, [message('Keep B')]);
});
