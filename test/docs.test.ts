import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { DEFAULT_CONFIG, resolveConfig } from "../src/config.js";
import { JobManager } from "../src/jobs.js";
import { runTask } from "../src/runner.js";
import { createTools } from "../src/tools.js";

/**
 * Documentation drift guards. These are intentionally cheap: they do not check prose quality, only
 * that the public surface and the links are actually present.
 */

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relative: string): Promise<string> {
  return readFile(path.join(root, relative), "utf8");
}

async function markdownFiles(): Promise<string[]> {
  const docs = await readdir(path.join(root, "docs"));
  return ["README.md", "CONTRIBUTING.md", "SECURITY.md", ...docs.map((file) => `docs/${file}`)].filter(
    (file) => file.endsWith(".md"),
  );
}

test("every registered tool is documented in the reference and the README", async () => {
  const config = resolveConfig();
  const jobs = new JobManager(config, (input, hooks) => runTask(config, input, hooks));
  const tools = createTools({
    config,
    jobs,
    directory: root,
    permission: { assert: async () => {} },
  });

  const reference = await read("docs/tools.md");
  const readme = await read("README.md");

  for (const tool of tools) {
    const name = `codex_${tool.name}`;
    assert.ok(reference.includes(name), `${name} is missing from docs/tools.md`);
    assert.ok(readme.includes(name), `${name} is missing from README.md`);
  }
});

test("every configuration option is documented", async () => {
  const options = [...Object.keys(DEFAULT_CONFIG), "defaultModel", "defaultEffort"];
  const reference = await read("docs/configuration.md");
  const readme = await read("README.md");

  for (const option of options) {
    const needle = `\`${option}\``;
    assert.ok(reference.includes(needle), `${option} is missing from docs/configuration.md`);
    assert.ok(readme.includes(needle), `${option} is missing from README.md`);
  }
});

test("relative documentation links resolve", async () => {
  const linkPattern = /\]\(([^)\s]+)\)/g;

  for (const file of await markdownFiles()) {
    const contents = await read(file);
    for (const match of contents.matchAll(linkPattern)) {
      const target = match[1];
      if (!target || /^(https?:|mailto:|#)/.test(target)) continue;

      const withoutAnchor = target.split("#")[0];
      if (!withoutAnchor) continue;

      const resolved = path.resolve(path.dirname(path.join(root, file)), withoutAnchor);
      await assert.doesNotReject(
        access(resolved),
        `${file} links to a missing file: ${target}`,
      );
    }
  }
});

test("the documentation index lists every document", async () => {
  const index = await read("docs/README.md");
  const documents = (await readdir(path.join(root, "docs"))).filter(
    (file) => file.endsWith(".md") && file !== "README.md",
  );

  for (const document of documents) {
    assert.ok(index.includes(document), `docs/README.md does not link ${document}`);
  }
});

test("the changelog has an entry for the current version", async () => {
  const changelog = await read("CHANGELOG.md");
  const manifest = JSON.parse(await read("package.json")) as { version: string };
  assert.ok(
    changelog.includes(`## [${manifest.version}]`),
    `CHANGELOG.md has no section for ${manifest.version}`,
  );
});
