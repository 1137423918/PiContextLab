import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentMessage } from '@earendil-works/pi-agent-core';
import { Store, type Claim } from '../src/store.js';
import { Warehouse, type Evidence } from '../src/warehouse.js';
import { Runner } from '../src/runtime.js';
import { scriptedProvider } from '../src/demo.js';
import { comparison } from './fixtures.js';
const [root, id, point] = process.argv.slice(2); if (!root || !id || !point) throw new Error('Missing crash control arguments');
function crash(): never { writeFileSync(join(root!, 'crash-marker'), point!); process.kill(process.pid, 'SIGKILL'); throw new Error('Unreachable'); }
class CrashStore extends Store {
  override messages(claim: Claim, messages: AgentMessage[]): void {
    super.messages(claim, messages); const last = messages.at(-1);
    if (point === 'assistant' && last?.role === 'assistant' && last.content.some(c => c.type === 'toolCall' && c.name === 'compare_metric')) crash();
  }
  override commitTool(claim: Claim, callId: string, request: unknown, result: unknown, evidence?: Evidence): void {
    super.commitTool(claim, callId, request, result, evidence); if (point === 'tool' && evidence?.kind === 'comparison') crash();
  }
}
const store = new CrashStore(join(root,'jobs.sqlite'));
await new Runner(store,new Warehouse(join(root,'datasets')),scriptedProvider(comparison),undefined,90000,65536,'budgeted').run(id);store.close();
