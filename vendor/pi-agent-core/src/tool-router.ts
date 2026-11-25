/** Deterministic lexical tool ranking with dependency closure and explicit schema budgets. */
import { toToolDeclaration } from "@earendil-works/pi-ai";
import type { ExecutableTools } from "./model-context.ts";

export interface ToolRoutingOptions {
	maxTools: number;
	maxSchemaBytes: number;
	alwaysInclude: readonly string[];
	dependencies?: Readonly<Record<string, readonly string[]>>;
	/** Preserve a catalog's complete documentation when it carries metadata beyond the wire schema. */
	routingDocuments?: Readonly<Record<string,string>>;
}

export interface RankedTool {
	name: string;
	score: number;
	schemaBytes: number;
}

export interface ToolRoutingDecision {
	tools: ExecutableTools;
	ranked: RankedTool[];
	schemaBytes: number;
}

/** Tokenize names, English terms and Chinese character bigrams without a model request. */
export function contextTerms(text: string): string[] {
	const lower = text.normalize("NFKC").toLowerCase();
	const latin: string[] = lower.match(/[a-z0-9]+/g) ?? [];
	const chinese = lower.match(/[\u3400-\u9fff]+/g) ?? [];
	for (const span of chinese) {
		if (span.length === 1) latin.push(span);
		else for (let i = 0; i < span.length - 1; i++) latin.push(span.slice(i, i + 2));
	}
	return latin;
}

/** Reuse a lexical index across queries without retaining a global corpus cache. */
export class ContextLexicalIndex {
	private readonly frequencies: Map<string, number>[];
	private readonly lengths: number[];
	private readonly documentFrequency = new Map<string, number>();
	private readonly average: number;

	constructor(documents: readonly string[]) {
		this.lengths = [];
		this.frequencies = documents.map((document) => {
			const words = contextTerms(document);
			this.lengths.push(words.length);
			const counts = new Map<string, number>();
			for (const word of words) counts.set(word, (counts.get(word) ?? 0) + 1);
			for (const word of counts.keys()) this.documentFrequency.set(word, (this.documentFrequency.get(word) ?? 0) + 1);
			return counts;
		});
		this.average = Math.max(1, this.lengths.reduce((n, length) => n + length, 0) / Math.max(1, documents.length));
	}

	/** Score with BM25's fixed k1=1.2,b=.75; the caller supplies only the current task text. */
	score(query: string): number[] {
		const terms = [...new Set(contextTerms(query))];
		const idf = new Map(terms.map((term) => {
			const n = this.documentFrequency.get(term) ?? 0;
			return [term, Math.log(1 + (this.frequencies.length - n + 0.5) / (n + 0.5))];
		}));
		return this.frequencies.map((counts, index) => terms.reduce((score, term) => {
			const frequency = counts.get(term) ?? 0;
			return score + (idf.get(term) ?? 0) * frequency * 2.2 / (frequency + 1.2 * (0.25 + 0.75 * this.lengths[index] / this.average));
		}, 0));
	}
}

/** Score documents with BM25; stable ties preserve registry order. */
export function rankContextDocuments(query: string, documents: readonly string[]): number[] {
	return new ContextLexicalIndex(documents).score(query);
}

const encoder = new TextEncoder();

/** Include required tools and complete dependency groups, then admit ranked candidates that fit. */
export function routeTools(
	query: string,
	registry: ExecutableTools,
	options: ToolRoutingOptions,
	promoted: readonly string[] = [],
): ToolRoutingDecision {
	if (!Number.isSafeInteger(options.maxTools) || options.maxTools < 1 || !Number.isSafeInteger(options.maxSchemaBytes) || options.maxSchemaBytes < 256) {
		throw new RangeError("Tool routing limits must be positive integers");
	}
	const byName = new Map(registry.map((tool) => [tool.name, tool]));
	if (byName.size !== registry.length) throw new Error("Tool registry has duplicate names");
	const sizes = new Map(registry.map((tool) => [tool.name, encoder.encode(JSON.stringify(toToolDeclaration(tool))).length]));
	const scores = rankContextDocuments(query, registry.map((tool) => options.routingDocuments?.[tool.name] ?? `${tool.name} ${tool.name} ${tool.description} ${JSON.stringify(tool.parameters)}`));
	const ranked = registry.map((tool, i) => ({ name: tool.name, score: scores[i], schemaBytes: sizes.get(tool.name)! }));
	ranked.sort((a, b) => b.score - a.score);
	const selected = new Set<string>();
	let schemaBytes = 0;
	const closure = (name: string, group = new Set<string>()): Set<string> => {
		if (group.has(name)) return group;
		if (!byName.has(name)) throw new Error(`Routing references an unregistered tool: ${name}`);
		group.add(name);
		for (const dependency of options.dependencies?.[name] ?? []) closure(dependency, group);
		return group;
	};
	const add = (names: readonly string[], required: boolean): void => {
		const group = new Set<string>();
		for (const name of names) for (const member of closure(name)) if (!selected.has(member)) group.add(member);
		const bytes = [...group].reduce((n, name) => n + sizes.get(name)!, 0);
		if (selected.size + group.size > options.maxTools || schemaBytes + bytes > options.maxSchemaBytes) {
			if (required) throw new Error("Required tool/dependency group exceeds the fixed routing budget");
			return;
		}
		for (const name of group) selected.add(name);
		schemaBytes += bytes;
	};
	add(options.alwaysInclude, true);
	add(promoted, true);
	for (const candidate of ranked) add([candidate.name], false);
	return { tools: registry.filter((tool) => selected.has(tool.name)), ranked, schemaBytes };
}
