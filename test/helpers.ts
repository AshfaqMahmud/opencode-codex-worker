import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function makeTempDir(prefix = "codex-worker-test-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

/**
 * Writes an executable stand-in for the Codex CLI. It honours `-o <file>` and prints a session id
 * on stderr, mirroring the parts of the real CLI that the plugin parses.
 */
export async function makeFakeCodex(): Promise<string> {
  const directory = await makeTempDir("fake-codex-");
  const file = path.join(directory, "codex");
  const script = `#!/usr/bin/env node
import { writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const outIndex = args.indexOf("-o");
const outputFile = outIndex >= 0 ? args[outIndex + 1] : undefined;
const mode = process.env.FAKE_CODEX_MODE ?? "ok";
const message = process.env.FAKE_CODEX_MESSAGE ?? "FAKE_CODEX_OK";

process.stderr.write(
  "OpenAI Codex v0.166.0\\n--------\\nworkdir: " +
    process.cwd() +
    "\\nsession id: 01a1a6d1-4be6-7e82-a0f6-3a47776698ee\\n--------\\n",
);

function finish() {
  if (process.env.FAKE_CODEX_TOUCH) writeFileSync(process.env.FAKE_CODEX_TOUCH, "touched\\n");
  if (outputFile) writeFileSync(outputFile, message + "\\n");
  process.stdout.write(message + "\\n");
}

if (mode === "fail") {
  process.stderr.write("fake failure\\n");
  process.exit(3);
} else if (mode === "slow") {
  process.stderr.write("working\\n");
  setTimeout(finish, 30_000);
} else {
  finish();
}
`;
  await writeFile(file, script, "utf8");
  await chmod(file, 0o755);
  return file;
}
