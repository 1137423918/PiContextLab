/** An opt-in core policy combining task-aware tool selection, bounded context and explicit recall. */
import { arr, compile, int, num, obj, str } from "@earendil-works/pi-schema";
import { toToolDeclaration } from "@earendil-works/pi-ai";
import { createContextReadTool, type ContextArtifactStore } from "./context-artifacts.ts";
import { contextBytes, packModelContext, type ContextPackingTrace } from "./context-budget.ts";
import type { ExecutableTools, ModelContextPolicy, ModelContextPolicyInput, PreparedModelContext } from "./model-context.ts";
import { routeTools, type RankedTool, type ToolRoutingOptions } from "./tool-router.ts";

export interface BudgetedPolicyTrace extends ContextPackingTrace {
	policy: "pi-context-lab-v2";
	request: number;
	registeredTools: number;
	selectedToolNames: string[];
	schemaBytes: number;
	ranking: RankedTool[];
}

export interface BudgetedPolicyOptions extends ToolRoutingOptions {
	maxContextBytes: number;
	inlineToolResultBytes: number;
	artifacts: ContextArtifactStore;
	onPrepared?: (trace: BudgetedPolicyTrace) => Promise<void> | void;
}

const discoverySchema = obj({ query: str({ minLength: 1, maxLength: 2000 }), limit: int({ minimum: 1, maximum: 3 }) });
const discoveryOutput = compile(obj({ candidates: arr(obj({ name: str(), score: num(), schemaBytes: int() })), instructions: str() }));

/** Select whole dependency groups and preserve recall handles without rewriting authoritative Agent state. */
export class BudgetedContextPolicy implements ModelContextPolicy {
	readonly tools: ExecutableTools;
	private readonly options: BudgetedPolicyOptions;
	private registry: ExecutableTools = [];
	private bound = false;
	private request = 0;

	constructor(options: BudgetedPolicyOptions) {
		this.options = options;
		this.tools = [createContextReadTool(options.artifacts), {
			name: "discover_tools", label: "Discover tools",
			description: "Find omitted tools when the current tool set does not support the task. Returned candidates and dependencies are exposed on the next request if the fixed budget permits. Do not guess unavailable tool names.",
			parameters: discoverySchema, replay: "safe",
			execute: async (_id, args, signal) => {
				signal?.throwIfAborted();
				const decision = routeTools(args.query, this.registry, { ...this.options, alwaysInclude: [] });
				const candidates = decision.ranked.filter((r) => !this.tools.some((t) => t.name === r.name)).slice(0, args.limit);
				const payload = { candidates, instructions: "Candidate schemas are added on the next provider request; all calls still require normal argument validation." };
				return { content: [{ type: "text", text: JSON.stringify(payload) }], details: payload };
			},
		}];
	}

	/** Registry lookup also works before the first post-restart model request. */
	register(tools: ExecutableTools): void {
		if (this.bound) throw new Error("A BudgetedContextPolicy instance belongs to one Agent; create a new policy for another conversation");
		this.bound = true;
		this.registry = tools;
	}

	async prepare(input: ModelContextPolicyInput, signal?: AbortSignal): Promise<PreparedModelContext> {
		signal?.throwIfAborted();
		this.request++;
		this.registry = input.tools;
		const promoted = new Set<string>();
		let assistantTurns = 0;
		for (const message of [...input.context.messages].reverse()) {
			if (message.role === "user") break;
			if (message.role === "assistant" && ++assistantTurns > 2) break;
			if (message.role !== "toolResult" || message.toolName !== "discover_tools" || message.isError) continue;
			const text = message.content.find((part) => part.type === "text");
			if (text?.type !== "text") throw new Error("Imported discovery result is missing its text payload");
			const payload: unknown = JSON.parse(text.text);
			if (!discoveryOutput.check(payload)) throw new Error("Imported discovery result does not match its output schema");
			for (const candidate of payload.candidates) promoted.add(candidate.name);
		}
		const user = [...input.context.messages].reverse().find((message) => message.role === "user");
		const query = user ? typeof user.content === "string" ? user.content : user.content.filter((part) => part.type === "text").map((part) => part.type === "text" ? part.text : "").join("\n") : "";
		const utilityNames = new Set(this.tools.map((tool) => tool.name));
		const business = input.tools.filter((tool) => !utilityNames.has(tool.name));
		const needsRead = input.context.messages.some((message) => message.role === "toolResult" && contextBytes(message.content) > this.options.inlineToolResultBytes) || contextBytes(input.context) > this.options.maxContextBytes;
		const reader = this.tools[0];
		const baseNames = [...this.options.alwaysInclude, ...(needsRead ? [reader.name] : [])];
		const totalSchemaBytes = [...business, ...(needsRead ? [reader] : [])].reduce((n, tool) => n + contextBytes(toToolDeclaration(tool)), 0);
		const needsDiscovery = business.length + Number(needsRead) > this.options.maxTools || totalSchemaBytes > this.options.maxSchemaBytes;
		const required = [...baseNames, ...(needsDiscovery ? ["discover_tools"] : [])];
		const candidates = input.tools.filter((tool) => !utilityNames.has(tool.name) || required.includes(tool.name));
		const decision = routeTools(query, candidates, { ...this.options, alwaysInclude: required }, [...promoted]);
		const packed = await packModelContext(input.context, decision.tools, query, { maxContextBytes: this.options.maxContextBytes, inlineToolResultBytes: this.options.inlineToolResultBytes, store: this.options.artifacts }, signal);
		const trace: BudgetedPolicyTrace = { policy: "pi-context-lab-v2", request: this.request, registeredTools: input.tools.length, selectedToolNames: decision.tools.map((t) => t.name), schemaBytes: decision.schemaBytes, ranking: decision.ranked, ...packed.trace };
		await this.options.onPrepared?.(trace);
		return { context: packed.context, tools: decision.tools };
	}
}
