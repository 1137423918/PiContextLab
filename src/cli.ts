import { mkdir, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { demoComparison,scriptedProvider } from './demo.js';
import { configuredProvider, Runner } from './runtime.js';
import { app } from './server.js';
import { Store } from './store.js';
import { Warehouse } from './warehouse.js';
async function main(): Promise<void> {
  const [command = 'serve', ...args] = process.argv.slice(2); const home = resolve(process.env.METRICLAB_HOME ?? '.metriclab'); await mkdir(home, { recursive: true });
  const warehouse = new Warehouse(join(home, 'datasets'));
  if (command === 'ingest') { if (!args[0] || !args[1]) throw new Error('ingest CSV SOURCE_MANIFEST'); console.log(JSON.stringify(await warehouse.ingest(args[0], args[1]), null, 2)); return; }
  const store = new Store(join(home, 'jobs.sqlite')); let runner: Runner | null = null; let mode = 'inspection-only';
  if (args.includes('--scripted-control')) { runner = new Runner(store, warehouse, scriptedProvider()); mode = 'scripted-control (NO model inference)'; }
  else if (process.env.DEEPSEEK_API_KEY || process.env.METRICLAB_API_KEY || process.env.METRICLAB_MODEL_URL) { const provider = configuredProvider(); runner = new Runner(store, warehouse, provider.stream, provider.model,provider.requestTimeoutMs,provider.maxContextBytes); mode = `configured-model · ${provider.model.provider}/${provider.model.id}`; }
  if (command === 'run') { if (!args[0] || !args[1] || !runner) throw new Error('run DATASET_ID QUESTION_FILE [--scripted-control]; configure provider for real inference'); const job = store.create(args[0], await readFile(args[1], 'utf8'),8,1200,args.includes('--scripted-control')?demoComparison:undefined); await runner.run(job.id); console.log(JSON.stringify({ job: store.job(job.id), report: store.report(job.id), calls: store.calls(job.id) }, null, 2)); store.close(); return; }
  if (command !== 'serve') throw new Error('Commands: ingest, run, serve');
  const port = Number(process.env.PORT ?? 4318); if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const server = app(store, warehouse, runner, mode); server.listen(port, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, mode, home })));
  let closing = false; const close = () => { if (closing) return; closing = true; server.close(); server.closeAllConnections(); void (async()=>{await runner?.shutdown();store.close();process.exit(0);})(); setTimeout(() => process.exit(1), 5000).unref(); };
  process.on('SIGTERM', close); process.on('SIGINT', close);
}
void main().catch(e => { console.error(e instanceof Error ? e.message : String(e)); process.exitCode = 1; });
