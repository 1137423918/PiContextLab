// Check the isolated server installation without running a language model.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Agent } from "@earendil-works/pi-agent-core";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { compile, obj, str } from "@earendil-works/pi-schema";
import { DuckDBInstance } from "@duckdb/node-api";

const versions = {};
for (const name of ["@earendil-works/pi-agent-core", "@earendil-works/pi-ai", "@earendil-works/pi-schema", "@duckdb/node-api", "typescript"]) {
  const path = new URL(`../node_modules/${name}/package.json`, import.meta.url);
  versions[name] = JSON.parse(readFileSync(path, "utf8")).version;
}
const database = new DatabaseSync(":memory:");
const answer = database.prepare("SELECT 42 AS answer").get();
database.close();
const schema = compile(obj({ message: str() }));
if (answer.answer !== 42 || !schema.check({ message: "installed" }) || typeof Agent !== "function" || typeof DuckDBInstance !== "function" || typeof createAssistantMessageEventStream !== "function") {
  throw new Error("Dependency installation contract failed");
}
console.log(JSON.stringify({ ready: true, node: process.version, versions, SQLite: true, Pi_runtime_imported: true, DuckDB_native_imported: true, model_calls: 0, GPU_used: false }));
