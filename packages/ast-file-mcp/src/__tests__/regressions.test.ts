/**
 * Bugs found while merging the Markdown and AsciiDoc twins, one test each.
 *
 * Every case here failed before its fix. Most come from the same root: a
 * behaviour written twice, where the copies had drifted -- four slug functions
 * that disagreed about which anchor a heading has, two `query` methods of which
 * only one honoured `heading`, three directory readers of which one answered an
 * unsupported pattern with an empty result instead of an error.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { AsciidocHandler } from "../handlers/asciidoc.js";

let dir: string;
const adoc = new AsciidocHandler();

async function file(params: { name: string; content: string }): Promise<string> {
  const path = join(dir, params.name);
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, params.content, "utf-8");
  return path;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "regressions-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("a one-line AsciiDoc admonition written back", () => {
  it.each([
    { name: "one line", source: "WARNING: careful\n", expected: "WARNING: careful" },
    { name: "a paragraph", source: "NOTE: two\nlines here\n", expected: "NOTE: two\nlines here" },
  ])("keeps its body when it is $name", async ({ source, expected }) => {
    // The parser puts a paragraph admonition's body in `source`, not `lines`;
    // the serialiser looked only at `lines` and wrote an empty `====` pair.
    const path = await file({ name: "admonition.adoc", content: `= T\n\n${source}` });
    const { ast } = await adoc.read(path);
    const out = join(dir, "out.adoc");

    await adoc.write({ filePath: out, ast });

    expect(await readFile(out, "utf-8")).toContain(expected);
  });
});
