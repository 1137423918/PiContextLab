/** Synthetic counterexample against frozen and current compiled hosts; never calls a model API. */
import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [source, output, expected] = process.argv.slice(2);
if (!source || !output || !['old-violation','rejected'].includes(expected)) throw new Error('COMPILED_SOURCE_ROOT NEW_OUTPUT_JSON old-violation|rejected');
const load = file => import(pathToFileURL(join(resolve(source), 'dist', file)).href);
const { fixture, comparison } = await load('test/fixtures.js');
const { Runner, completedStream, message } = await load('src/runtime.js');
const { scriptedProvider } = await load('src/demo.js');
const f = await fixture();
try {
 const job = f.store.create(f.dataset.id, 'Synthetic long-event recovery counterexample', 8, 1200, comparison);
 const claim = f.store.claim(job.id);
 const initial = new Runner(f.store, f.warehouse, scriptedProvider(comparison), undefined, 90000, 65536, 'budgeted');
 f.store.recordContextPrepared(claim, { selectedToolNames: initial.tools(claim).map(t => t.name) });
 for (let i = 0; i < 510; i++) f.store.event(job.id, 'synthetic_control_noise', { i });
 const assistant = message(initial.model, [{ type: 'toolCall', id: 'restricted-query', name: 'compare_metric', arguments: comparison }], 'toolUse');
 // Older JS ignores this third argument: the old host has no request-bound tool record.
 const call = f.store.reserve(claim, 'controlled-restricted-response', ['request_clarification']);
 f.store.reply(claim, call.id, assistant);
 f.store.messages(claim, [{ role: 'user', content: job.question, timestamp: job.created }, { ...assistant, thinkingLevel: 'off' }]);
 f.store.recordContextPrepared(claim, { selectedToolNames: ['request_clarification'] });
 f.store.recordContextPrepared(claim, { selectedToolNames: initial.tools(claim).map(t => t.name) });
 f.store.db.prepare('UPDATE jobs SET lease=0 WHERE id=?').run(job.id);
 let requests = 0;
 await new Runner(f.store, f.warehouse, model => {
  requests++;
  return completedStream(message(model, [{ type: 'toolCall', id: 'clarify', name: 'request_clarification', arguments: { question: 'Please confirm this investigation before continuing.' } }], 'toolUse'));
 }, undefined, 90000, 65536, 'budgeted').run(job.id);
 const result = f.store.job(job.id).messages.find(m => m.role === 'toolResult' && m.toolCallId === 'restricted-query');
 const evidence = f.store.evidence(job.id).length;
 const summary = { kind: 'synthetic engineering counterexample, not model accuracy', source: resolve(source), initial_event_page: f.store.events(job.id).length, event_count: Number(f.store.db.prepare('SELECT count(*) n FROM events WHERE job=?').get(job.id).n), selected_on_response: ['request_clarification'], recovered_query_rejected: Boolean(result?.isError), query_evidence_written: evidence, provider_requests: requests, real_API_calls: 0, GPU_used: false, status: f.store.job(job.id).status };
 await writeFile(output, JSON.stringify(summary, null, 2) + '\n', { flag: 'wx' });
 console.log(JSON.stringify(summary));
 assert.equal(summary.query_evidence_written, expected === 'rejected' ? 0 : 1);
 assert.equal(summary.recovered_query_rejected, expected === 'rejected');
 assert.equal(summary.status, expected === 'rejected' ? 'clarification' : 'failed');
} finally { f.store.close(); await rm(f.root, { recursive: true, force: true }); }
