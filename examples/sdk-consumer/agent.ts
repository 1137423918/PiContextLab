/** Reusable SDK wiring. Caller owns model credentials, artifact scope, persistence and business checks. */
import {
 Agent, BudgetedContextPolicy, CONTEXT_RECALL_BUDGET_GROUP,
 type BudgetedPolicyOptions, type ContextArtifactStore, type ExecutableTools, type StreamFn,
} from '@earendil-works/pi-agent-core';
import type { Api, Model } from '@earendil-works/pi-ai';

export interface ContextAgentOptions {
 model: Model<Api>;
 streamFn: StreamFn;
 tools: ExecutableTools;
 artifacts: ContextArtifactStore;
 systemPrompt: string;
 maxContextBytes: number;
 maxTools: number;
 maxSchemaBytes: number;
 alwaysInclude: readonly string[];
 dependencies?: Readonly<Record<string, readonly string[]>>;
 exactResultRetention?: boolean;
 onPrepared?: NonNullable<BudgetedPolicyOptions['onPrepared']>;
 onResultBudgetPlanned?: NonNullable<BudgetedPolicyOptions['onResultBudgetPlanned']>;
}

/** A new policy per Agent; no default global state or implicit model request. */
export function createContextManagedAgent(options: ContextAgentOptions) {
 const policy = new BudgetedContextPolicy({
  artifacts: options.artifacts,
  maxContextBytes: options.maxContextBytes,
  inlineToolResultBytes: 4096,
  maxTools: options.maxTools,
  maxSchemaBytes: options.maxSchemaBytes,
  alwaysInclude: options.alwaysInclude,
  dependencies: options.dependencies ?? {},
  artifactSearch: false,
  exactResultRetention: options.exactResultRetention ?? false,
  recallResultBudget: true,
  onPrepared: trace => options.onPrepared?.(trace),
  onResultBudgetPlanned: (input, budgets, trace) => options.onResultBudgetPlanned?.(input, budgets, trace),
 });
 const agent = new Agent({
  modelContextPolicy: policy,
  toolResultBudgets: { [CONTEXT_RECALL_BUDGET_GROUP]: 8192 },
  toolValidationFeedback: 'bounded',
  streamFn: options.streamFn,
  initialState: { model: options.model, tools: options.tools, systemPrompt: options.systemPrompt },
 });
 return { agent, policy };
}
