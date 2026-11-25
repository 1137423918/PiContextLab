/** Query-ranked exact JSON subtrees, not a generated summary or business-answer extractor. */
import { parseContextJson } from "./context-json.ts";
import { ContextLexicalIndex, contextTerms } from "./tool-router.ts";

export const CONTEXT_RETENTION_LIMITS = { sourceBytes: 8 * 1024 * 1024, nodes: 20000, depth: 32, candidates: 4096, path: 512, unitBytes: 768, perResultBytes: 1536, totalBytes: 4096, unitsPerResult: 16 } as const;
export interface ContextRetainedSlice { json_pointer: string; source_json: string; }
export interface ContextRetentionScan { visited: number; candidates: number; truncated: boolean; status: "ok" | "not-json" | "source-limit" | "no-query"; }
export interface RankedContextSlice { slice: ContextRetainedSlice; score: number; }
const bytes = (value: string) => new TextEncoder().encode(value).length;

/** A nonoverlapping structural frontier: each admitted subtree is complete, numeric literals preserved. */
export function rankContextSlices(text: string, query: string, signal?: AbortSignal): { ranked: RankedContextSlice[]; scan: ContextRetentionScan } {
	const scan: ContextRetentionScan = { visited: 0, candidates: 0, truncated: false, status: "ok" };
	if (bytes(text) > CONTEXT_RETENTION_LIMITS.sourceBytes) return { ranked: [], scan: { ...scan, status: "source-limit" } };
	if (!contextTerms(query).length) return { ranked: [], scan: { ...scan, status: "no-query" } };
	let parsed: ReturnType<typeof parseContextJson>;
	try { parsed = parseContextJson(text); } catch (error) { if (error instanceof SyntaxError) return { ranked: [], scan: { ...scan, status: "not-json" } }; throw error; }
	// First bound traversal, before serialization of deeply nested/unbounded subtrees.
	const sizes = new WeakMap<object, number>();
	const measure = (value: unknown, depth: number, parent?: object, key?: string): number | undefined => {
		signal?.throwIfAborted();
		if (++scan.visited > CONTEXT_RETENTION_LIMITS.nodes || depth > CONTEXT_RETENTION_LIMITS.depth) { scan.truncated = true; return undefined; }
		if (value === null || typeof value !== "object") return bytes(parsed.json(value, parent, key));
		let total = 2, first = true;
		for (const name of Object.keys(value)) {
			if (scan.visited >= CONTEXT_RETENTION_LIMITS.nodes) { scan.truncated = true; return undefined; }
			const size = measure((value as Record<string, unknown>)[name], depth + 1, value, name);
			if (size === undefined) return undefined;
			total += size + (first ? 0 : 1) + (Array.isArray(value) ? 0 : bytes(JSON.stringify(name)) + 1); first = false;
		}
		sizes.set(value, total); return total;
	};
	// Partial traversal is never represented as a complete candidate.
	measure(parsed.value, 0);
	const entries: { slice: ContextRetainedSlice; document: string; bytes: number }[] = [];
	const visit = (value: unknown, path: string, depth: number, parent?: object, key?: string, labels = ""): void => {
		signal?.throwIfAborted();
		if (depth > CONTEXT_RETENTION_LIMITS.depth || path.length > CONTEXT_RETENTION_LIMITS.path || entries.length >= CONTEXT_RETENTION_LIMITS.candidates) { scan.truncated = true; return; }
		const size = value !== null && typeof value === "object" ? sizes.get(value) : bytes(parsed.json(value, parent, key));
		if (size !== undefined && size <= CONTEXT_RETENTION_LIMITS.unitBytes) {
			const source_json = parsed.json(value, parent, key), slice = { json_pointer: path, source_json };
			entries.push({ slice, document: `${path} ${path} ${labels} ${source_json}`, bytes: bytes(JSON.stringify(slice)) }); return;
		}
		if (value === null || typeof value !== "object") return;
		// Skip unmeasured branches after the traversal cap; do not start another unbounded scan.
		if (size === undefined && scan.truncated) return;
		const siblings = Object.entries(value).filter(([, item]) => typeof item === "string" && item.length <= 80).slice(0, 4).map(([name, item]) => `${name} ${item}`).join(" ").slice(0, 240);
		for (const name of Object.keys(value)) {
			if (entries.length >= CONTEXT_RETENTION_LIMITS.candidates) { scan.truncated = true; break; }
			visit((value as Record<string, unknown>)[name], `${path}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1, value, name, `${labels} ${siblings}`.slice(-480));
		}
	};
	visit(parsed.value, "", 0);
	scan.candidates = entries.length;
	const scores = new ContextLexicalIndex(entries.map(entry => entry.document)).score(query);
	const ranked = entries.map((entry, i) => ({ slice: entry.slice, score: scores[i] / Math.sqrt(entry.bytes), i })).filter(entry => entry.score > 0).sort((a, b) => b.score - a.score || a.i - b.i).map(({ slice, score }) => ({ slice, score }));
	return { ranked, scan };
}
