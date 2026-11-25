/** Bounded schema feedback; the original assistant arguments remain the audit source. */
import type { AgentToolResult } from "./types.ts";

export const VALIDATION_FEEDBACK_MAX_BYTES = 2048;
const encoder = new TextEncoder();
const bytes = (value: unknown): number => encoder.encode(JSON.stringify(value)).length;

interface FieldShape {
	pointer: string;
	kind: string;
	code_points?: number;
	utf16_units?: number;
	length?: number;
}

function fieldShapes(args: unknown): { fields: FieldShape[]; total: number } {
	if (!args || typeof args !== "object" || Array.isArray(args)) return { fields: [], total: 0 };
	const entries = Object.entries(args);
	const fields: FieldShape[] = [];
	for (const [key, value] of entries) {
		if (fields.length === 8) break;
		const pointer = "/" + key.replace(/~/g, "~0").replace(/\//g, "~1");
		if (encoder.encode(pointer).length > 128) continue;
		if (typeof value === "string") {
			let count = 0;
			for (const _point of value) count++;
			fields.push({ pointer, kind: "string", code_points: count, utf16_units: value.length });
		} else if (Array.isArray(value)) fields.push({ pointer, kind: "array", length: value.length });
		else fields.push({ pointer, kind: value === null ? "null" : typeof value });
	}
	return { fields, total: entries.length };
}

/** Bound the serialized content array, including JSON escaping; no argument values or full error in details. */
export function boundedToolValidationError(error: unknown, preparedArguments: unknown): AgentToolResult<{
	kind: "bounded_validation_feedback";
	original_error_utf8_bytes: number;
	content_json_utf8_bytes: number;
}> {
	const original = error instanceof Error ? error.message : String(error);
	const marker = original.indexOf("\n\nReceived arguments:\n");
	const diagnostic = marker < 0 ? original : original.slice(0, marker);
	const shapes = fieldShapes(preparedArguments);
	const payload = {
		error: "INVALID_TOOL_ARGUMENTS",
		diagnostic: "",
		diagnostic_truncated: false,
		received_arguments_omitted: marker >= 0,
		argument_stage: "after_prepareArguments",
		fields: shapes.fields,
		fields_omitted: shapes.total - shapes.fields.length,
		source: "Original input remains in assistant toolCall.arguments or argumentsError. Field shapes contain no values. Correct arguments and retry within the existing job budget.",
	};
	const content = () => [{ type: "text" as const, text: JSON.stringify(payload) }];
	while (bytes(content()) > VALIDATION_FEEDBACK_MAX_BYTES && payload.fields.length > 0) {
		payload.fields.pop(); payload.fields_omitted++;
	}
	payload.diagnostic = diagnostic;
	if (bytes(content()) > VALIDATION_FEEDBACK_MAX_BYTES) {
		payload.diagnostic_truncated = true;
		// Work on code points so a cut never leaves half a valid surrogate pair.
		const points = Array.from(diagnostic);
		let low = 0, high = points.length;
		while (low < high) {
			const middle = Math.ceil((low + high) / 2);
			payload.diagnostic = points.slice(0, middle).join("");
			if (bytes(content()) <= VALIDATION_FEEDBACK_MAX_BYTES) low = middle;
			else high = middle - 1;
		}
		payload.diagnostic = points.slice(0, low).join("");
	}
	const result = content();
	return { content: result, isError: true, details: { kind: "bounded_validation_feedback", original_error_utf8_bytes: encoder.encode(original).length, content_json_utf8_bytes: bytes(result) } };
}
