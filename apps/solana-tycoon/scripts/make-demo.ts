import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildDemoSession } from "../src/engine/replay/synthetic";

const output = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "demo-session.jsonl");
const lines = buildDemoSession(7);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${lines.map((line) => JSON.stringify(line)).join("\n")}\n`);
console.log(`Wrote ${lines.length} lines to ${output}`);
