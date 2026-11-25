/** JSON pointer access that preserves source numeric literals instead of rounding through Number. */
export interface ContextJson {
	value: unknown;
	text(value: unknown, parent?: object, key?: string): string;
	json(value: unknown, parent?: object, key?: string): string;
}

export function parseContextJson(text: string): ContextJson {
	const numbers = new WeakMap<object, Map<string, string>>();
	let rootNumber: string | undefined;
	const value: unknown = JSON.parse(text, function (this: object, key: string, item: unknown, context?: { source?: string }): unknown {
		if (typeof item === "number") {
			if (typeof context?.source !== "string") throw new Error("Exact numeric recall requires JSON.parse source contexts in this Node runtime");
			let fields = numbers.get(this);
			if (!fields) { fields = new Map(); numbers.set(this, fields); }
			fields.set(key, context.source);
			if (key === "") rootNumber = context.source;
		}
		return item;
	});
	const json = (item: unknown, parent?: object, key?: string): string => {
		if (typeof item === "number") {
			const literal = parent && key !== undefined ? numbers.get(parent)?.get(key) : rootNumber;
			if (literal === undefined) throw new Error("Numeric source identity is unavailable");
			return literal;
		}
		if (item === null || typeof item === "string" || typeof item === "boolean") return JSON.stringify(item);
		if (Array.isArray(item)) return `[${item.map((entry, i) => json(entry, item, String(i))).join(",")}]`;
		if (typeof item === "object") return `{${Object.entries(item).map(([name, entry]) => `${JSON.stringify(name)}:${json(entry, item, name)}`).join(",")}}`;
		throw new Error("Unsupported JSON value");
	};
	return { value, json, text: (item, parent, key) => typeof item === "string" ? item : json(item, parent, key) };
}

export function resolveContextPointer(document: ContextJson, pointer: string): { value: unknown; parent?: object; key?: string } {
	if (pointer !== "" && !pointer.startsWith("/")) throw new Error("JSON pointer must be empty or start with /");
	let value = document.value;
	let parent: object | undefined;
	let last: string | undefined;
	for (const raw of pointer === "" ? [] : pointer.slice(1).split("/")) {
		if (/~(?![01])/u.test(raw)) throw new Error("Invalid JSON pointer escape");
		const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/u.test(key)) throw new Error("JSON pointer array segment must be an index");
		if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) throw new Error("JSON pointer does not exist");
		parent = value; last = key; value = (value as Record<string, unknown>)[key];
	}
	return { value, parent, key: last };
}
