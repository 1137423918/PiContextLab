/** Deterministic per-assistant-batch budgets for cooperating bounded-result tools. */
import type { ExecutableTools } from "./model-context.ts";
import type { AgentToolCall, AgentToolCallOutcome } from "./types.ts";

export const CONTEXT_RECALL_BUDGET_GROUP = "context-recall";
export const contentJsonBytes = (content: unknown): number => new TextEncoder().encode(JSON.stringify(content)).length;

export function allocateToolResultBudgets(
	calls: readonly AgentToolCall[], tools: readonly ExecutableTools[number][],
	budgets?: Readonly<Record<string, number>>,
): ReadonlyMap<string, number> {
	const allocations = new Map<string, number>();
	if (!budgets || Object.keys(budgets).length === 0) return allocations;
	for (const value of Object.values(budgets)) if (!Number.isSafeInteger(value) || value < 256) throw new RangeError("Tool result group budgets must be safe integers >=256");
	if (new Set(calls.map(call => call.id)).size !== calls.length) throw new Error("Result budget cannot bind repeated tool-call IDs");
	const groups = new Map<string, { id: string; min: number; max: number }[]>();
	for (const call of calls) {
		const spec = tools.find(tool => tool.name === call.name)?.resultBudget;
		if (!spec || !Object.hasOwn(budgets, spec.group)) continue;
		if (!Number.isSafeInteger(spec.minBytes) || spec.minBytes < 256 || !Number.isSafeInteger(spec.maxBytes) || spec.maxBytes < spec.minBytes) throw new RangeError("Invalid tool result budget metadata");
		const group = groups.get(spec.group) ?? [];
		group.push({ id: call.id, min: spec.minBytes, max: spec.maxBytes }); groups.set(spec.group, group);
	}
	for (const [name, group] of groups) {
		let remaining = budgets[name] - group.reduce((n, call) => n + call.min, 0);
		if (remaining < 0) throw new Error("Tool result batch minimum exceeds group budget; no calls executed");
		for (const call of group) allocations.set(call.id, call.min);
		let active = group.filter(call => call.max > call.min);
		while (remaining > 0 && active.length > 0) {
			const share = Math.max(1, Math.floor(remaining / active.length));
			for (const call of active) {
				const current = allocations.get(call.id)!;
				const extra = Math.min(share, call.max - current, remaining);
				allocations.set(call.id, current + extra); remaining -= extra;
			}
			active = active.filter(call => allocations.get(call.id)! < call.max);
		}
	}
	return allocations;
}

/** Final enforcement includes validation failures and afterToolCall overrides. */
export function enforceToolResultBudget(outcome: AgentToolCallOutcome, limit?: number): AgentToolCallOutcome {
	if (limit === undefined) return outcome;
	if (!Number.isSafeInteger(limit) || limit < 256) throw new RangeError("Tool result allocation must be a safe integer >=256");
	const actual = contentJsonBytes(outcome.result.content ?? []);
	if (actual <= limit) return outcome;
	return { ...outcome, isError: true, result: {
		content: [{ type: "text", text: JSON.stringify({ error: "TOOL_RESULT_BUDGET_EXCEEDED", retry: "Request fewer calls or less output. Original arguments remain in the assistant call." }) }],
		details: { allocated_bytes: limit, rejected_content_bytes: actual }, isError: true,
		...(outcome.result.terminate === undefined ? {} : { terminate: outcome.result.terminate }),
		...(outcome.result.usage === undefined ? {} : { usage: outcome.result.usage }),
	} };
}
