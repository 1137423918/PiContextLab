/** Request-scoped context policy contracts; authoritative agent history stays unchanged. */
import type { Api, Model, TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentContext } from "./types.ts";

export type ExecutableTools = NonNullable<AgentContext["tools"]>;

/** A provider view and its matching execution allowlist for exactly one model response. */
export interface PreparedModelContext {
	context: TranscriptContext;
	tools: ExecutableTools;
}

/** A policy sees the normalized transcript, after the caller's existing context transform. */
export interface ModelContextPolicyInput {
	context: TranscriptContext;
	tools: ExecutableTools;
	model: Model<Api>;
}

/** An opt-in native Agent policy; utility tools enter the normal registry and validation path. */
export interface ModelContextPolicy {
	readonly tools: ExecutableTools;
	/** Bind normal registry lookup before a recovered utility call can execute. */
	register?(tools: ExecutableTools): void;
	prepare(input: ModelContextPolicyInput, signal?: AbortSignal): Promise<PreparedModelContext>;
}
