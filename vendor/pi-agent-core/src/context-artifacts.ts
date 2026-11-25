/** Immutable text artifacts and bounded, explicit recall for provider-context views. */
import type { AgentTool } from "./types.ts";
import { arr, int, obj, str } from "@earendil-works/pi-schema";
import { parseContextJson, resolveContextPointer } from "./context-json.ts";

export interface ContextArtifact {
	id: string;
	sha256: string;
	bytes: number;
	kind: "tool-result" | "history-turn" | "history-index";
	text: string;
}

/** Implementations scope reads/writes to one conversation; put must be idempotent by content ID. */
export interface ContextArtifactStore {
	put(artifact: ContextArtifact): Promise<void>;
	get(id: string): Promise<ContextArtifact | undefined>;
}

export interface ContextReadContinuation {
	artifact_id: string;
	json_pointers: string[];
	offset: number;
	limit: number;
}

/** Create an immutable identity for exact UTF-8 bytes, with no LLM summary. */
export async function contextArtifact(text: string, kind: ContextArtifact["kind"]): Promise<ContextArtifact> {
	const bytes = new TextEncoder().encode(text);
	const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
	const sha256 = [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, "0")).join("");
	return { id: `ctx_${kind}_${sha256}`, sha256, bytes: bytes.length, kind, text };
}

const readSchema = obj({
	artifact_id: str({ description: "ctx_ artifact handle, not a source document/report identity" }),
	json_pointers: arr(str({ maxLength: 512 }), { minItems: 1, maxItems: 8, description: "Read several precise RFC6901 paths in one call. Use [\"\"] only for bounded raw text inspection." }),
	offset: int({ minimum: 0, description: "Offset in Unicode code points. Copy the selected value's next_read cursor when continuing; batch values can have different cursors." }),
	limit: int({ minimum: 1, maximum: 4096, description: "Total Unicode code-point budget across all requested values" }),
});

/** Recall exact archived data without returning an unbounded result to the model. */
export function createContextReadTool(store: ContextArtifactStore): AgentTool<typeof readSchema, unknown> {
	return {
		name: "read_context_artifact",
		label: "Recall context artifact",
		description: "Read exact archived context data by artifact ID and JSON pointer. Use this when a context reference omitted required facts; never guess omitted values. For paging, copy that value's next_read object verbatim. The limit is shared across all values, so do not calculate the next offset from the requested limit.",
		parameters: readSchema,
		replay: "safe",
		async execute(_callId, args, signal) {
			signal?.throwIfAborted();
			if (!Number.isSafeInteger(args.offset) || args.offset < 0 || !Number.isSafeInteger(args.limit) || args.limit < 1 || args.limit > 4096) throw new RangeError("Read offset and limit must be bounded safe integers");
			const artifact = await store.get(args.artifact_id);
			if (!artifact) throw new Error("Artifact does not belong to this conversation or does not exist");
			const verified = await contextArtifact(artifact.text, artifact.kind);
			if (verified.id !== args.artifact_id || verified.sha256 !== artifact.sha256 || verified.bytes !== artifact.bytes) throw new Error("Context artifact integrity mismatch");
			const parsed = args.json_pointers.some((pointer) => pointer !== "") ? parseContextJson(artifact.text) : null;
			let remaining = args.limit;
			const values = [];
			for (const pointer of args.json_pointers) {
				try {
				const field = pointer === "" ? null : resolveContextPointer(parsed!, pointer);
				const text = field ? parsed!.text(field.value, field.parent, field.key) : artifact.text;
				const points = Array.from(text);
				const slice = points.slice(args.offset, args.offset + remaining);
				const nextOffset = args.offset + slice.length;
				const hasMore = nextOffset < points.length;
				const nextRead: ContextReadContinuation | null = hasMore ? { artifact_id: artifact.id, json_pointers: [pointer], offset: nextOffset, limit: args.limit } : null;
				values.push({ json_pointer: pointer, offset: args.offset, total_codepoints: points.length, text: slice.join(""), returned_codepoints: slice.length, next_offset: nextOffset, next_read: nextRead, has_more: hasMore });
				remaining -= slice.length;
				} catch (error) {
					// One wrong path must not discard other exact values in the same bounded read.
					values.push({ json_pointer: pointer, error: error instanceof Error ? error.message : "Invalid JSON pointer" });
				}
			}
			const payload = { artifact_id: artifact.id, sha256: artifact.sha256, values, codepoints_used: args.limit - remaining, source_identity_note: "The ctx_ handle identifies stored bytes, not the source report or document." };
			return { content: [{ type: "text", text: JSON.stringify(payload) }], details: payload };
		},
	};
}
