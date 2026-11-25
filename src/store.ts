import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { AgentMessage, ContextArtifact } from '@earendil-works/pi-agent-core';
import { explicitComparison,hash, POLICY, type Comparison, type Submission } from './domain.js';
import type { Evidence } from './warehouse.js';

export type Status = 'queued' | 'running' | 'paused' | 'clarification' | 'completed' | 'failed' | 'cancelled';
export interface Job { id: string; dataset: string; question: string; status: Status; max_calls: number; max_output: number; epoch: number; owner: string | null; lease: number; cancel: number; messages: AgentMessage[]; error: string | null; created: number; }
export interface Claim { id: string; owner: string; epoch: number; }
export interface Report { id: string; job: string; dataset: string; title: string; evidence: Evidence[]; interpretation: string; hypotheses: string[]; created: number; }
interface SqlJob extends Omit<Job, 'messages'> { messages: string; }
function assistantIdentity(reply: unknown): string {
  // Pi annotates this field after the provider reply is persisted. It is not response identity.
  if (reply !== null && typeof reply === 'object' && !Array.isArray(reply)) {
    const { thinkingLevel: _thinking, ...content } = reply as Record<string,unknown>; return hash(content);
  }
  return hash(reply);
}
export class Store {
  readonly db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path); this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,dataset TEXT NOT NULL,question TEXT NOT NULL,status TEXT NOT NULL,max_calls INTEGER NOT NULL,max_output INTEGER NOT NULL,epoch INTEGER NOT NULL DEFAULT 0,owner TEXT,lease INTEGER NOT NULL DEFAULT 0,cancel INTEGER NOT NULL DEFAULT 0,messages TEXT NOT NULL DEFAULT '[]',error TEXT,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,job TEXT NOT NULL,kind TEXT NOT NULL,payload TEXT NOT NULL,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,job TEXT NOT NULL,request_hash TEXT NOT NULL,status TEXT NOT NULL,reply TEXT,created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS tools(job TEXT NOT NULL,call_id TEXT NOT NULL,request_hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(job,call_id));
      CREATE TABLE IF NOT EXISTS evidence(job TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job,id));
      CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,job TEXT NOT NULL UNIQUE,payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(report TEXT PRIMARY KEY,decision TEXT NOT NULL,note TEXT NOT NULL,created INTEGER NOT NULL);`);
    this.db.exec('CREATE TABLE IF NOT EXISTS runtime_configs(job TEXT PRIMARY KEY,fingerprint TEXT NOT NULL,payload TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS context_artifacts(job TEXT NOT NULL,id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job,id))');
    this.db.exec('CREATE TABLE IF NOT EXISTS job_intents(job TEXT PRIMARY KEY,payload TEXT NOT NULL)');
    this.db.exec('CREATE TABLE IF NOT EXISTS call_tool_sets(call_id TEXT PRIMARY KEY,job TEXT NOT NULL,tool_names TEXT NOT NULL,assistant_hash TEXT)');
    this.db.exec('CREATE INDEX IF NOT EXISTS call_tool_sets_reply ON call_tool_sets(job,assistant_hash)');
    this.db.exec('CREATE TABLE IF NOT EXISTS result_budget_plans(job TEXT NOT NULL,assistant_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(job,assistant_hash))');
    this.db.exec('CREATE INDEX IF NOT EXISTS events_by_kind ON events(job,kind,seq)');
  }
  close(): void { this.db.close(); }
  transaction<T>(fn: () => T): T { this.db.exec('BEGIN IMMEDIATE'); try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; } }
  create(dataset: string, question: string, maxCalls = 8, maxOutput = 1200,requested?:Comparison): Job {
    if (!question.trim() || question.length > 6000 || !Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 20 || !Number.isInteger(maxOutput) || maxOutput < 128 || maxOutput > 4000) throw new Error('Invalid question or fixed call budget');
    const id = randomUUID();this.transaction(()=>{this.db.prepare('INSERT INTO jobs(id,dataset,question,status,max_calls,max_output,created) VALUES(?,?,?,?,?,?,?)').run(id, dataset, question, 'queued', maxCalls, maxOutput, Date.now());const intent=requested??explicitComparison(question);if(intent)this.db.prepare('INSERT INTO job_intents VALUES(?,?)').run(id,JSON.stringify(intent));});return this.job(id);
  }
  intent(job:string):Comparison|null {const row=this.db.prepare('SELECT payload FROM job_intents WHERE job=?').get(job);return row?JSON.parse(String(row.payload)) as Comparison:null;}
  clarify(claim:Claim,question:string):void {this.transaction(()=>{this.assert(claim);this.event(claim.id,'clarification',{question});});}
  job(id: string): Job {
    const row = this.db.prepare('SELECT * FROM jobs WHERE id=?').get(id) as unknown as SqlJob | undefined;
    if (!row) throw new Error('Job not found'); return { ...row, messages: JSON.parse(row.messages) as AgentMessage[] };
  }
  list(): Job[] { return (this.db.prepare('SELECT id FROM jobs ORDER BY created DESC LIMIT 100').all() as { id: string }[]).map(r => this.job(r.id)); }
  claim(id: string, now = Date.now()): Claim {
    return this.transaction(() => {
      const job = this.job(id); if (job.cancel || ['completed', 'failed', 'cancelled', 'clarification'].includes(job.status)) throw new Error(`Job is ${job.status}`);
      if (job.owner && job.lease > now) throw new Error('Job already has an active writer');
      const owner = randomUUID(), epoch = job.epoch + 1;
      this.db.prepare("UPDATE jobs SET owner=?,epoch=?,lease=?,status='running',error=NULL WHERE id=?").run(owner, epoch, now + 15000, id);
      this.db.prepare("UPDATE calls SET status='unknown' WHERE job=? AND status='pending'").run(id);
      this.event(id, 'claimed', { epoch }); return { id, owner, epoch };
    });
  }
  assert(claim: Claim): Job {
    const j = this.job(claim.id); if (j.owner !== claim.owner || j.epoch !== claim.epoch || j.lease <= Date.now()) throw new Error('Stale writer'); if (j.cancel) throw new Error('Cancelled'); return j;
  }
  heartbeat(claim: Claim): void { this.transaction(() => { this.assert(claim); this.db.prepare('UPDATE jobs SET lease=? WHERE id=?').run(Date.now() + 15000, claim.id); }); }
  putContextArtifact(claim:Claim,artifact:ContextArtifact):void { this.transaction(()=>{this.assert(claim);const payload=JSON.stringify(artifact);const existing=this.db.prepare('SELECT payload FROM context_artifacts WHERE job=? AND id=?').get(claim.id,artifact.id);if(existing && existing.payload!==payload)throw new Error('Context artifact identity collision');this.db.prepare('INSERT OR IGNORE INTO context_artifacts VALUES(?,?,?)').run(claim.id,artifact.id,payload);}); }
  recordContextPrepared(claim:Claim,trace:unknown):void { this.transaction(()=>{this.assert(claim);this.event(claim.id,'context_prepared',trace);}); }
  getContextArtifact(job:string,id:string):ContextArtifact|undefined { const row=this.db.prepare('SELECT payload FROM context_artifacts WHERE job=? AND id=?').get(job,id);return row?JSON.parse(String(row.payload)) as ContextArtifact:undefined; }
  bindRuntime(claim: Claim, config: unknown): void { this.transaction(()=>{this.assert(claim);const fingerprint=hash(config);const existing=this.db.prepare('SELECT fingerprint FROM runtime_configs WHERE job=?').get(claim.id);if(existing && existing.fingerprint!==fingerprint)throw new Error('Runtime configuration changed; create a new investigation');this.db.prepare('INSERT OR IGNORE INTO runtime_configs VALUES(?,?,?)').run(claim.id,fingerprint,JSON.stringify(config));}); }
  event(job: string, kind: string, payload: unknown): void { this.db.prepare('INSERT INTO events(job,kind,payload,created) VALUES(?,?,?,?)').run(job, kind, JSON.stringify(payload), Date.now()); }
  events(job: string, after = 0): unknown[] { return this.db.prepare('SELECT * FROM events WHERE job=? AND seq>? ORDER BY seq LIMIT 500').all(job, after).map(r => ({ ...r, payload: JSON.parse(String(r.payload)) as unknown })); }
  recentEvents(job: string): unknown[] { return this.db.prepare('SELECT * FROM events WHERE job=? ORDER BY seq DESC LIMIT 500').all(job).reverse().map(r=>({...r,payload:JSON.parse(String(r.payload)) as unknown})); }
  latestEvent(job: string, kind: string): unknown | null { const row=this.db.prepare('SELECT payload FROM events WHERE job=? AND kind=? ORDER BY seq DESC LIMIT 1').get(job,kind);return row?JSON.parse(String(row.payload)) as unknown:null; }
  needsClarification(job: string): boolean { return this.db.prepare("SELECT 1 FROM events WHERE job=? AND kind='clarification' LIMIT 1").get(job)!==undefined; }
  toolsForAssistant(claim: Claim, assistant: AgentMessage): string[] {
    this.assert(claim);
    const rows=this.db.prepare('SELECT tool_names FROM call_tool_sets WHERE job=? AND assistant_hash=?').all(claim.id,assistantIdentity(assistant));
    if(rows.length===0)throw new Error('Missing request-bound tool selection for saved assistant; create a new investigation');
    const selections=[...new Set(rows.map(r=>String(r.tool_names)))];
    if(selections.length!==1)throw new Error('Ambiguous request-bound tool selection for saved assistant');
    return JSON.parse(selections[0]!) as string[];
  }
  saveResultBudgets(claim:Claim,assistant:AgentMessage,budgets:Readonly<Record<string,number>>,projection?:unknown):void {
    this.transaction(()=>{this.toolsForAssistant(claim,assistant);
      if(Object.values(budgets).some(value=>!Number.isSafeInteger(value)||value<256))throw new Error('Invalid persisted result budgets');
      const identity=assistantIdentity(assistant),payload=JSON.stringify(Object.fromEntries(Object.entries(budgets).sort(([a],[b])=>a.localeCompare(b))));
      const prior=this.db.prepare('SELECT payload FROM result_budget_plans WHERE job=? AND assistant_hash=?').get(claim.id,identity);
      if(prior&&prior.payload!==payload)throw new Error('Saved result budget plan cannot change');
      if(!prior){this.db.prepare('INSERT INTO result_budget_plans VALUES(?,?,?)').run(claim.id,identity,payload);this.event(claim.id,'result_budget_planned',{assistant_hash:identity,budgets,...(projection===undefined?{}:{projection})});}
    });
  }
  resultBudgetsForAssistant(claim:Claim,assistant:AgentMessage):Readonly<Record<string,number>>|undefined {
    this.toolsForAssistant(claim,assistant);const row=this.db.prepare('SELECT payload FROM result_budget_plans WHERE job=? AND assistant_hash=?').get(claim.id,assistantIdentity(assistant));
    return row?Object.freeze(JSON.parse(String(row.payload)) as Record<string,number>):undefined;
  }
  messages(claim: Claim, messages: AgentMessage[]): void { this.transaction(() => { this.assert(claim); this.db.prepare('UPDATE jobs SET messages=? WHERE id=?').run(JSON.stringify(messages), claim.id); }); }
  finish(claim: Claim, status: Status, error: string | null = null): void {
    this.transaction(() => { const j = this.job(claim.id); if (j.owner !== claim.owner || j.epoch !== claim.epoch) return;
      this.db.prepare('UPDATE jobs SET status=?,error=?,owner=NULL,lease=0 WHERE id=?').run(j.cancel ? 'cancelled' : status, error, claim.id); this.event(claim.id, 'settled', { status: j.cancel ? 'cancelled' : status, error }); });
  }
  cancel(id: string): void { this.transaction(() => { const job=this.job(id); if (job.status==='cancelled') return; if (['completed','failed','clarification'].includes(job.status)) throw new Error('Settled job cannot be cancelled'); this.db.prepare("UPDATE jobs SET cancel=1,status='cancelled' WHERE id=?").run(id); this.event(id, 'cancelled', {}); }); }
  reserve(claim: Claim, requestHash: string, selectedTools?: readonly string[]): { id: string; reply: unknown | null } {
    return this.transaction(() => {
      const job = this.assert(claim);
      if(selectedTools && (selectedTools.some(name=>typeof name!=='string'||name.length===0)||new Set(selectedTools).size!==selectedTools.length))throw new Error('Invalid request-bound tool selection');
      const cached = this.db.prepare("SELECT id,reply FROM calls WHERE job=? AND request_hash=? AND status='done' AND coalesce(json_extract(reply,'$.stopReason'),'stop') NOT IN ('error','aborted') ORDER BY created LIMIT 1").get(job.id, requestHash);
      if (cached) {
        if(selectedTools){const binding=this.db.prepare('SELECT tool_names FROM call_tool_sets WHERE call_id=? AND job=?').get(String(cached.id),job.id);if(!binding||binding.tool_names!==JSON.stringify(selectedTools))throw new Error('Cached reply execution tool selection differs from the current request');}
        return { id: String(cached.id), reply: JSON.parse(String(cached.reply)) as unknown };
      }
      const n = this.db.prepare('SELECT count(*) n FROM calls WHERE job=?').get(job.id);
      if (Number(n?.n) >= job.max_calls) throw new Error('Fixed model request budget exhausted; unknown attempts remain charged');
      const id = randomUUID(); this.db.prepare("INSERT INTO calls VALUES(?,?,?,'pending',NULL,?)").run(id, job.id, requestHash, Date.now());
      if(selectedTools)this.db.prepare('INSERT INTO call_tool_sets(call_id,job,tool_names) VALUES(?,?,?)').run(id,job.id,JSON.stringify(selectedTools));
      this.event(job.id, 'model_reserved', { id, ceiling: job.max_output }); return { id, reply: null };
    });
  }
  reply(claim: Claim, id: string, reply: unknown): void { this.transaction(() => { this.assert(claim); const saved=this.db.prepare("UPDATE calls SET status='done',reply=? WHERE id=? AND job=? AND status='pending'").run(JSON.stringify(reply), id, claim.id);if(saved.changes)this.db.prepare('UPDATE call_tool_sets SET assistant_hash=? WHERE call_id=? AND job=?').run(assistantIdentity(reply),id,claim.id); }); }
  calls(job: string): unknown[] { return this.db.prepare("SELECT id,request_hash,status,created,json_extract(reply,'$.usage') usage,json_extract(reply,'$.stopReason') stop_reason FROM calls WHERE job=? ORDER BY created").all(job).map(row=>({...row,usage:row.usage?JSON.parse(String(row.usage)) as unknown:null})); }
  cachedTool(claim: Claim, id: string, request: unknown): unknown | undefined {
    this.assert(claim); const row = this.db.prepare('SELECT request_hash,result FROM tools WHERE job=? AND call_id=?').get(claim.id, id);
    if (!row) return undefined; if (row.request_hash !== hash(request)) throw new Error('Tool call identity collision'); return JSON.parse(String(row.result)) as unknown;
  }
  commitTool(claim: Claim, id: string, request: unknown, result: unknown, evidence?: Evidence): void {
    this.transaction(() => { this.assert(claim); const existing = this.cachedTool(claim, id, request); if (existing !== undefined) return;
      if (evidence) this.db.prepare('INSERT OR IGNORE INTO evidence VALUES(?,?,?)').run(claim.id, evidence.id, JSON.stringify(evidence));
      this.db.prepare('INSERT INTO tools VALUES(?,?,?,?)').run(claim.id, id, hash(request), JSON.stringify(result)); this.event(claim.id, 'tool_committed', { call_id: id, evidence: evidence?.id ?? null }); });
  }
  evidence(job: string): Evidence[] { return this.db.prepare('SELECT payload FROM evidence WHERE job=? ORDER BY id').all(job).map(r => JSON.parse(String(r.payload)) as Evidence); }
  report(job: string): Report | null { const row = this.db.prepare('SELECT payload FROM reports WHERE job=?').get(job); return row ? JSON.parse(String(row.payload)) as Report : null; }
  submit(claim: Claim, submission: Submission): Report {
    return this.transaction(() => { const job = this.assert(claim); const evidence = submission.evidence_ids.map(id => {
      const e = this.evidence(job.id).find(e => e.id === id); if (!e || e.dataset !== job.dataset || e.policy !== POLICY || hash({ rows: e.rows, result: e.result }) !== e.result_sha256) throw new Error('Missing, corrupt or wrong-version evidence');
      const { id: _id, ...payload } = e; if (`ev_${hash(payload)}` !== e.id) throw new Error('Evidence identity mismatch'); return e;
    });
      if (!evidence.some(e => e.kind === 'comparison')) throw new Error('A report requires a comparison');
      const intent=this.intent(job.id);if(!intent||!evidence.some(e=>e.kind==='comparison'&&hash(e.request)===hash(intent)))throw new Error('Report must include the explicitly requested comparison');
      for (const breakdown of evidence.filter(e => e.kind === 'breakdown')) {
        const request = breakdown.request as { comparison: Comparison };
        const comparison = evidence.find(e => e.kind === 'comparison' && hash(e.request) === hash(request.comparison));
        if (!comparison) throw new Error('Breakdown requires a matching metric and period comparison');
        const totals = (breakdown.result as { totals: { baseline: string; current: string; delta: string } }).totals;
        const values = comparison.result as { baseline: string; current: string; delta: string };
        for (const key of ['baseline', 'current', 'delta'] as const) if (totals[key] !== values[key]) throw new Error('Breakdown does not reconcile with comparison');
      }
      const payload = { job: job.id, dataset: job.dataset, title: submission.title, evidence, interpretation: submission.interpretation, hypotheses: submission.hypotheses };
      const id = `report_${hash(payload)}`; const existing = this.report(job.id); if (existing) { if (existing.id !== id) throw new Error('Report already sealed'); return existing; }
      const report = { id, ...payload, created: Date.now() }; this.db.prepare('INSERT INTO reports VALUES(?,?,?)').run(id, job.id, JSON.stringify(report)); this.event(job.id, 'report_sealed', { id }); return report;
    });
  }
  review(job: string, reportId: string, decision: string, note: string): void {
    if (!['accepted', 'needs_changes'].includes(decision) || note.trim().length < 5 || note.length > 2000) throw new Error('Review requires a decision and human note');
    const report = this.report(job); if (!report || report.id !== reportId) throw new Error('Review must bind current report version');
    this.db.prepare('INSERT OR REPLACE INTO reviews VALUES(?,?,?,?)').run(reportId, decision, note, Date.now()); this.event(job, 'human_review', { report: reportId, decision, note });
  }
  reviewFor(report: string): unknown { return this.db.prepare('SELECT * FROM reviews WHERE report=?').get(report) ?? null; }
}
