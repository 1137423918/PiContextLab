/** Bounded lexical field location in exact archived JSON; no code execution or model request. */
import { int, obj, str } from "@earendil-works/pi-schema";
import type { AgentTool } from "./types.ts";
import { contextArtifact, type ContextArtifactStore } from "./context-artifacts.ts";
import { parseContextJson } from "./context-json.ts";
import { ContextLexicalIndex, contextTerms } from "./tool-router.ts";
import { contentJsonBytes, CONTEXT_RECALL_BUDGET_GROUP } from "./tool-result-budget.ts";

export const CONTEXT_FIELD_LIMITS = { maxSourceBytes: 8 * 1024 * 1024, maxNodes: 20000, maxDepth: 32, maxFields: 4096, maxPath: 512, responseBytes: 8192, previewCodepoints: 256 } as const;
interface Field { json_pointer: string; text: string; type: string; document: string; }

/** Query only ranks source paths and short primitive content. Labels never enter this function. */
export function searchContextFields(text: string, query: string, limit: number) {
	if (new TextEncoder().encode(text).length > CONTEXT_FIELD_LIMITS.maxSourceBytes) throw new Error("JSON field search exceeds its8MiB source limit; use bounded raw reads");
	if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20 || query.length > 2000 || contextTerms(query).length === 0) throw new Error("Invalid bounded field search query or result count");
	const parsed = parseContextJson(text);
	const fields: Field[] = [];
	let visited = 0;
	let truncated = false;
	const visit = (value: unknown, path: string, depth: number, parent?: object, key?: string, labels = ""): void => {
		if (++visited > CONTEXT_FIELD_LIMITS.maxNodes || depth > CONTEXT_FIELD_LIMITS.maxDepth || fields.length >= CONTEXT_FIELD_LIMITS.maxFields || path.length > CONTEXT_FIELD_LIMITS.maxPath) { truncated = true; return; }
		if (value === null || typeof value !== "object") {
			const exact = parsed.text(value, parent, key);
			fields.push({ json_pointer: path, text: exact, type: value === null ? "null" : typeof value, document: `${path} ${path} ${labels} ${exact.slice(0, 384)}` });
			return;
		}
		// Short sibling scalar labels distinguish array entries without business-specific field rules.
		const entries = Object.entries(value);
		const context = entries.filter(([, v]) => typeof v === "string" && v.length <= 80).slice(0, 8).map(([k, v]) => `${k} ${v}`).join(" ").slice(0, 512);
		for (const [name, child] of entries) {
			if (visited >= CONTEXT_FIELD_LIMITS.maxNodes || fields.length >= CONTEXT_FIELD_LIMITS.maxFields) { truncated = true; break; }
			visit(child, `${path}/${name.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1, value, name, `${labels} ${context}`.slice(-768));
		}
	};
	visit(parsed.value, "", 0);
	const scores = new ContextLexicalIndex(fields.map(field => field.document)).score(query);
	const ranked = scores.map((score, i) => ({ score, i })).filter(row => row.score > 0).sort((a, b) => b.score - a.score || a.i - b.i);
	return { fields, ranked, scan: { visited, fields: fields.length, truncated, complete: !truncated } };
}

const searchSchema = obj({
	artifact_id: str({ description: "Existing ctx_ handle belonging to this conversation" }),
	query: str({ minLength: 1, maxLength: 2000, description: "Field names or nearby labels to locate, e.g. published timestamp or comparison result checksum" }),
	limit: int({ minimum: 1, maximum: 20 }),
});

export function createContextSearchTool(store: ContextArtifactStore): AgentTool<typeof searchSchema, unknown> {
	return {
		name: "search_context_artifact", label: "Locate archived JSON fields",
		description: "Locate exact JSON pointers and bounded source values in an archived artifact when paths are unknown. Search is lexical and may be incomplete; never treat no matches as proof of absence. Use read_context_artifact for longer values. No code or SQL is executed. A host shared byte budget may defer a reply; deferred does not mean no matches.",
		parameters: searchSchema, replay: "safe",
		resultBudget: { group: CONTEXT_RECALL_BUDGET_GROUP, minBytes: 256, maxBytes: 8192 },
		async execute(_id, args, signal, _update, execution) {
			signal?.throwIfAborted();
			const artifact = await store.get(args.artifact_id);
			if (!artifact) throw new Error("Artifact does not belong to this conversation or does not exist");
			const verified = await contextArtifact(artifact.text, artifact.kind);
			if (verified.id !== args.artifact_id || verified.sha256 !== artifact.sha256 || verified.bytes !== artifact.bytes) throw new Error("Context artifact integrity mismatch");
			const found = searchContextFields(artifact.text, args.query, args.limit);
			const matches: { json_pointer: string; text: string; type: string; has_more: boolean; score: number }[] = [];
			const payload = { artifact_id: artifact.id, sha256: artifact.sha256, matches, scan: found.scan, response_byte_limit: CONTEXT_FIELD_LIMITS.responseBytes, results_truncated: false, ...(execution ? { response_budget_bytes: execution.resultBudgetBytes } : {}) };
			for (const row of found.ranked) {
				if (matches.length >= args.limit) { payload.results_truncated = true; break; }
				const field = found.fields[row.i];
				const points = Array.from(field.text);
				matches.push({ json_pointer: field.json_pointer, text: points.slice(0, CONTEXT_FIELD_LIMITS.previewCodepoints).join(""), type: field.type, has_more: points.length > CONTEXT_FIELD_LIMITS.previewCodepoints, score: row.score });
				if (new TextEncoder().encode(JSON.stringify(payload)).length > CONTEXT_FIELD_LIMITS.responseBytes - 8) { matches.pop(); payload.results_truncated = true; break; }
			}
			signal?.throwIfAborted();
			if (execution) {
				const content = () => [{ type: "text" as const, text: JSON.stringify(payload) }];
				while (matches.length > 0 && contentJsonBytes(content()) > execution.resultBudgetBytes) { matches.pop(); payload.results_truncated = true; }
				if (contentJsonBytes(content()) > execution.resultBudgetBytes || found.ranked.length > 0 && matches.length === 0) {
					const deferred = { status: "deferred", reason: "batch_byte_budget", retry: "Retry the original search alone or with fewer results; no absence conclusion." };
					return { content: [{ type: "text", text: JSON.stringify(deferred) }], details: deferred };
				}
			}
			return { content: [{ type: "text", text: JSON.stringify(payload) }], details: payload };
		},
	};
}
