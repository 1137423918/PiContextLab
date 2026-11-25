/** Immutable text artifacts and bounded, explicit recall for provider-context views. */
import type { AgentTool } from "./types.ts";
import { arr, int, obj, str } from "@earendil-works/pi-schema";

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
	offset: int({ minimum: 0, description: "Offset in Unicode code points of the selected value" }),
	limit: int({ minimum: 1, maximum: 4096, description: "Total Unicode code-point budget across all requested values" }),
});

/** Recall exact archived data without returning an unbounded result to the model. */
export function createContextReadTool(store: ContextArtifactStore): AgentTool<typeof readSchema, unknown> {
	return {
		name: "read_context_artifact",
		label: "Recall context artifact",
		description: "Read exact archived context data by artifact ID and JSON pointer. Use this when a context reference omitted required facts; never guess omitted values.",
		parameters: readSchema,
		replay: "safe",
		async execute(_callId, args, signal) {
			signal?.throwIfAborted();
			const artifact = await store.get(args.artifact_id);
			if (!artifact) throw new Error("Artifact does not belong to this conversation or does not exist");
			const verified = await contextArtifact(artifact.text, artifact.kind);
			if (verified.id !== args.artifact_id || verified.sha256 !== artifact.sha256 || verified.bytes !== artifact.bytes) throw new Error("Context artifact integrity mismatch");
			const parsed: unknown = args.json_pointers.some((pointer) => pointer !== "") ? JSON.parse(artifact.text) : null;
			let remaining = args.limit;
			const values = [];
			for (const pointer of args.json_pointers) {
				try {
				let value = parsed;
				if (pointer !== "" && !pointer.startsWith("/")) throw new Error("JSON pointer must be empty or start with /");
				for (const raw of pointer === "" ? [] : pointer.slice(1).split("/")) {
					if (/~(?![01])/u.test(raw)) throw new Error("Invalid JSON pointer escape");
					const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
					if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(key)) throw new Error("JSON pointer array segment must be an index");
					if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("JSON pointer does not exist");
					value = (value as Record<string, unknown>)[key];
				}
				const text = pointer === "" ? artifact.text : typeof value === "string" ? value : JSON.stringify(value);
				const points = Array.from(text);
				const slice = points.slice(args.offset, args.offset + remaining);
				values.push({ json_pointer: pointer, offset: args.offset, total_codepoints: points.length, text: slice.join(""), has_more: args.offset + slice.length < points.length });
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
