import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { int, obj, opt, str } from '@earendil-works/pi-schema';
import { catalog,comparisonSchema,explicitComparison,parse,validateComparison } from './domain.js';
import { demoComparison } from './demo.js';
import { exportReport } from './report.js';
import { Runner } from './runtime.js';
import { Store } from './store.js';
import { Warehouse } from './warehouse.js';
const createSchema = obj({ dataset: str(), question: str(), max_calls: opt(int()), max_output: opt(int()),intent:opt(comparisonSchema) });
const reviewSchema = obj({ report_id: str(), decision: str(), note: str() });
async function body(req: IncomingMessage): Promise<unknown> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new Error('Use application/json');
  let size = 0; const parts: Buffer[] = []; for await (const part of req) { const b = Buffer.from(part as Uint8Array); size += b.length; if (size > 16384) throw new Error('Request too large'); parts.push(b); }
  return JSON.parse(Buffer.concat(parts).toString('utf8')) as unknown;
}
export function app(store: Store, warehouse: Warehouse, runner: Runner | null, mode: string, webRoot = join(process.cwd(), 'web')) {
  const send = (res: ServerResponse, code: number, value: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  const server = createServer((req, res) => { void (async () => {
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    const address = server.address(); const port = address && typeof address === 'object' ? address.port : 0;
    const hosts = [`127.0.0.1:${port}`, `localhost:${port}`]; if (!hosts.includes(req.headers.host ?? '')) throw new Error('Invalid Host');
    const origin = `http://${req.headers.host}`;
    if (req.method === 'POST' && ((req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')) throw new Error('Cross-origin write rejected');
    const url = new URL(req.url ?? '/', origin); const parts = url.pathname.split('/').filter(Boolean);
    if (req.method === 'GET' && ['/','/app.js','/style.css'].includes(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1); const bytes = await readFile(join(webRoot, name));
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); res.end(bytes); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/overview') { send(res, 200, { mode, catalog, datasets: await warehouse.list(), jobs: store.list().map(({ messages: _messages, ...job }) => job) }); return; }
    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      if (!runner) throw new Error('Model provider is not configured'); const input = parse(createSchema, await body(req)); const dataset=await warehouse.dataset(input.dataset);
      const intent=mode.startsWith('scripted-control')?demoComparison:input.intent??explicitComparison(input.question)??undefined;if(intent)validateComparison(intent,dataset.min_time,dataset.max_time);
      const job = store.create(input.dataset, input.question, input.max_calls, input.max_output,intent); send(res, 201, job); void runner.run(job.id).catch(e => store.event(job.id, 'runner_error', { message: String(e) })); return;
    }
    if (parts[0] === 'api' && parts[1] === 'jobs' && parts[2]) {
      const id = parts[2]; const job = store.job(id);
      if (req.method === 'GET' && parts.length === 3) { const report = store.report(id); send(res, 200, { job,intent:store.intent(id), calls: store.calls(id), evidence: store.evidence(id), report, review: report ? store.reviewFor(report.id) : null, events: store.recentEvents(id),context_policy:store.latestEvent(id,'context_prepared') }); return; }
      if (req.method === 'GET' && parts[3] === 'events') {
        const after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? '0'); if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor');
        res.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' }); let cursor = after;
        const tick = () => { for (const entry of store.events(id, cursor)) { const ev = entry as { seq: number }; cursor = ev.seq; res.write(`id: ${cursor}\ndata: ${JSON.stringify(entry)}\n\n`); } res.write(': heartbeat\n\n'); };
        tick(); const timer = setInterval(tick, 1500); req.on('close', () => clearInterval(timer)); return;
      }
      if (req.method === 'GET' && parts[3] === 'export') { const report = store.report(id); if (!report) throw new Error('No report'); res.setHeader('Content-Disposition', `attachment; filename="metriclab-${id}.html"`); res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(exportReport(report, store.reviewFor(report.id))); return; }
      if (req.method === 'POST' && parts[3] === 'cancel') { if (runner) runner.cancel(id); else store.cancel(id); send(res, 200, { status: 'cancelled' }); return; }
      if (req.method === 'POST' && parts[3] === 'resume') { await body(req); if (!runner) throw new Error('Provider not configured'); if (!['running', 'paused', 'queued'].includes(job.status)) throw new Error('Job cannot resume'); void runner.run(id).catch(e => store.event(id, 'resume_rejected', { message: String(e) })); send(res, 202, { status: 'resume_requested' }); return; }
      if (req.method === 'POST' && parts[3] === 'review') { const input = parse(reviewSchema, await body(req)); store.review(id, input.report_id, input.decision, input.note); send(res, 200, { saved: true }); return; }
    }
    send(res, 404, { error: 'Not found' });
  })().catch(e => { if (!res.headersSent) send(res, 400, { error: e instanceof Error ? e.message : String(e) }); else res.end(); }); });
  return server;
}
