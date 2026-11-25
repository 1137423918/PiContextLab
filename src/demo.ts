import type { StreamFn } from '@earendil-works/pi-agent-core';
import type { JsonObject } from '@earendil-works/pi-ai';
import { completedStream, message } from './runtime.js';
import type { Comparison } from './domain.js';

export const demoComparison: Comparison = { metric: 'net_sales', baseline: { start: '2011-10-01', end: '2011-11-01' }, current: { start: '2011-11-01', end: '2011-12-01' }, basis: 'calendar_month' };
// A transparent runtime control, never presented as model reasoning or an accuracy result.
export function scriptedProvider(comparison = demoComparison): StreamFn {
  return (model, context) => {
    const results = context.messages.filter(m => m.role === 'toolResult');
    const response = (name: string, args: JsonObject) => completedStream(message(model, [{ type: 'toolCall', name, arguments: args, id: `control-${results.length}` }], 'toolUse'));
    if (results.length === 0) return response('inspect_dataset', {});
    if (results.length === 1) return response('compare_metric', comparison);
    if (results.length === 2) return response('breakdown_change', { comparison, dimension: 'country', limit: 5 });
    const ids = results.flatMap(r => { try { const content = r.content.find(c => c.type === 'text'); const value: unknown = JSON.parse(content?.text ?? '{}'); return typeof value === 'object' && value !== null && 'id' in value && typeof value.id === 'string' && value.id.startsWith('ev_') ? [value.id] : []; } catch { return []; } });
    return response('submit_investigation', { title: 'Scripted Pi runtime control · monthly net sales', evidence_ids: ids, interpretation: 'Scripted control: numerical facts are in the evidence tables. This run makes no model capability claim.', hypotheses: ['Changes in product or country mix need independent business validation.'] });
  };
}
