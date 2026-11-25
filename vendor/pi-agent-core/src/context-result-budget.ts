/** Post-response admission for a pure recall batch; uses the actual response and a complete projected transaction. */
import { normalizeContext } from "@earendil-works/pi-ai";
import { ContextPackingLimitError, contextBytes, packModelContext, type ContextPackingOptions, type ContextPackingTrace } from "./context-budget.ts";
import type { ToolResultBudgetInput } from "./model-context.ts";
import { allocateToolResultBudgets, CONTEXT_RECALL_BUDGET_GROUP } from "./tool-result-budget.ts";

export interface ContextResultBudgetTrace {
	hardLimitBytes: number;
	configuredContentBytes: number;
	allocatedContentBytes: number;
	projectedContextBytes: number;
	envelopeMarginBytes: number;
	targetProjectionBytes: number;
	fellBackToHardLimit: boolean;
	packing: ContextPackingTrace;
}

/** Mixed/unregistered batches retain static caps: unknown outputs cannot share a proven estimate. */
export async function planContextResultBudget(input: ToolResultBudgetInput, options: ContextPackingOptions, signal?: AbortSignal): Promise<{ budgets: Readonly<Record<string, number>>; trace: ContextResultBudgetTrace } | undefined> {
	const group = CONTEXT_RECALL_BUDGET_GROUP;
	const calls = input.assistantMessage.content.filter(part => part.type === "toolCall");
	if (!calls.length || !Object.hasOwn(input.budgets, group) || calls.some(call => !["read_context_artifact", "search_context_artifact"].includes(call.name) || input.tools.find(tool => tool.name === call.name)?.resultBudget?.group !== group)) return undefined;
	const initial = allocateToolResultBudgets(calls, input.tools, input.budgets);
	const desired = [...initial.values()].reduce((sum, value) => sum + value, 0);
	const minimum = calls.reduce((sum, call) => sum + input.tools.find(tool => tool.name === call.name)!.resultBudget!.minBytes, 0);
	// Empty content costs two bytes. Reserve additional space for ordinary result timestamp/duration envelopes.
	// This margin is not a bound on arbitrary hooks, usage or transformations; the next hard gate remains required.
	const margin = 256 * calls.length;
	const projected = normalizeContext({ messages: [...input.context.messages, input.assistantMessage, ...calls.map(call => ({ role: "toolResult" as const, toolCallId: call.id, toolName: call.name, content: [], isError: false, timestamp: 0 }))] });
	const target = Math.max(1024, options.maxContextBytes - desired - margin + 2 * calls.length);
	const user = [...input.context.messages].reverse().find(message => message.role === "user");
	const query = user ? typeof user.content === "string" ? user.content : user.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("\n") : "";
	const pack = (maxContextBytes: number) => packModelContext(projected, input.tools, query, { ...options, maxContextBytes }, signal);
	let packed: Awaited<ReturnType<typeof pack>>, fallback = false;
	try { packed = await pack(target); }
	catch (error) {
		if (!(error instanceof ContextPackingLimitError)) throw error;
		fallback = true; packed = await pack(options.maxContextBytes);
	}
	const projectedBytes = contextBytes(packed.context);
	const available = options.maxContextBytes - projectedBytes + 2 * calls.length - margin;
	const allocated = Math.min(desired, available);
	if (allocated < minimum) throw new ContextPackingLimitError("Recall batch cannot reserve its minimum result bytes within the context ceiling; no calls executed");
	const budgets = Object.freeze({ ...input.budgets, [group]: allocated });
	allocateToolResultBudgets(calls, input.tools, budgets);
	return { budgets, trace: { hardLimitBytes: options.maxContextBytes, configuredContentBytes: input.budgets[group], allocatedContentBytes: allocated, projectedContextBytes: projectedBytes, envelopeMarginBytes: margin, targetProjectionBytes: target, fellBackToHardLimit: fallback, packing: packed.trace } };
}
