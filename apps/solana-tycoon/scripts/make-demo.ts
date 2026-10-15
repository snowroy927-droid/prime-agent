import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildKrakenDemo } from "../src/engine/kraken/synthetic";
import { formatRecording, type RecordingLine } from "../src/engine/replay/recording";
import { buildDemoSession } from "../src/engine/replay/synthetic";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(fixtures, { recursive: true });

function write(name: string, lines: readonly RecordingLine[]): void {
	const output = join(fixtures, name);
	writeFileSync(output, formatRecording(lines));
	console.log(`Wrote ${lines.length} lines to ${output}`);
}

write("demo-session.jsonl", buildDemoSession(7));
write("kraken-demo-session.jsonl", buildKrakenDemo(7));
