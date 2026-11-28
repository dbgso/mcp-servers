import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ChainManager } from "../chain-manager.js";
import { getDefaultConfig } from "../config.js";
import type { CheckReport, Document, FindingKind } from "../types.js";

let root: string;
let manager: ChainManager;

function kinds(report: CheckReport, id?: string): FindingKind[] {
  return report.findings.filter(f => id === undefined || f.id === id).map(f => f.kind).sort();
}

function writeCode(file: string, text: string): void {
  const full = path.join(root, file);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, text);
}

/** philosophy → requirement → spec → design → implementation, bound to src/ */
async function buildChain(): Promise<Record<"ph" | "rq" | "sp" | "ds" | "im", Document>> {
  const ph = await manager.create({ type: "philosophy", title: "Simplicity", content: "Prefer fewer moving parts" });
  const rq = await manager.create({ type: "requirement", title: "Login", content: "Users can log in", requires: ph.id });
  const sp = await manager.create({ type: "spec", title: "OAuth", content: "OAuth2 code flow", requires: rq.id });
  const ds = await manager.create({ type: "design", title: "Token flow", content: "Tokens in cookies", requires: sp.id });
  const im = await manager.create({ type: "implementation", title: "Auth module", content: "src/auth.ts", requires: ds.id });
  writeCode("src/auth.ts", "export const auth = 1;\n");
  await manager.bindCode({ id: im.id, paths: ["src"] });
  return { ph, rq, sp, ds, im };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "chain-drift-"));
  const config = getDefaultConfig(path.join(root, "docs/chain"));
  config.codeRoot = root;
  manager = new ChainManager(config);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("check on a fresh chain", () => {
  test("a fully realized chain is clean", async () => {
    await buildChain();
    const report = await manager.check();
    expect(report).toMatchObject({ ok: true, errors: 0, warnings: 0, findings: [], escalations: [] });
  });

  test("a requirement without a philosophy is a missing parent", async () => {
    await expect(manager.create({ type: "requirement", title: "R", content: "x" }))
      .rejects.toThrow('requires a parent of type: philosophy');
  });

  test("decisions not carried down are unrealized warnings, not errors", async () => {
    const ph = await manager.create({ type: "philosophy", title: "P", content: "x" });
    const report = await manager.check();
    expect(report.ok).toBe(true);
    expect(report.findings).toEqual([expect.objectContaining({ id: ph.id, kind: "unrealized", severity: "warning" })]);
  });

  test("an implementation bound to no code is a warning", async () => {
    const { ds } = await buildChain();
    const bare = await manager.create({ type: "implementation", title: "Bare", content: "x", requires: ds.id });
    expect(kinds(await manager.check(), bare.id)).toEqual(["no_code"]);
  });
});

describe("drift between documents", () => {
  test("changing a middle document flags it upward and its child downward", async () => {
    const { sp, ds } = await buildChain();
    await manager.update({ id: sp.id, updates: { content: "OAuth2 + PKCE" } });

    const report = await manager.check();
    expect(report.ok).toBe(false);
    expect(kinds(report, sp.id)).toEqual(["self_changed"]);
    expect(kinds(report, ds.id)).toEqual(["parent_changed"]);
    // Only the changed document itself is settled first; its child waits
    expect(report.escalations.find(e => e.document.id === sp.id)?.actionable).toBe(true);
    expect(report.escalations.find(e => e.document.id === ds.id)?.actionable).toBe(false);
  });

  test("the grandchild is not flagged until its parent actually changes", async () => {
    const { sp, im } = await buildChain();
    await manager.update({ id: sp.id, updates: { content: "changed" } });
    expect(kinds(await manager.check(), im.id)).toEqual([]);
  });

  test("a title change counts as a change", async () => {
    const { rq, sp } = await buildChain();
    await manager.update({ id: rq.id, updates: { title: "Sign in" } });
    expect(kinds(await manager.check(), sp.id)).toEqual(["parent_changed"]);
  });

  test("an update with nothing in it changes nothing", async () => {
    const { sp } = await buildChain();
    await manager.update({ id: sp.id, updates: {} });
    expect((await manager.check()).ok).toBe(true);
  });

  test("escalations list every ancestor, nearest first", async () => {
    const { ph, rq, sp, ds } = await buildChain();
    await manager.update({ id: ds.id, updates: { content: "changed" } });
    const escalation = (await manager.check()).escalations.find(e => e.document.id === ds.id);
    expect(escalation?.ancestors.map(a => a.id)).toEqual([sp.id, rq.id, ph.id]);
  });
});

describe("confirm", () => {
  test("is refused below an unresolved decision, naming the topmost one", async () => {
    const { rq, sp, ds } = await buildChain();
    await manager.update({ id: rq.id, updates: { content: "changed" } });
    await manager.update({ id: sp.id, updates: { content: "changed" } });
    await expect(manager.confirm({ id: ds.id })).rejects.toThrow(`requirement "Login" (${rq.id}) is unresolved`);
  });

  test("walking top-down clears the chain", async () => {
    const { sp, ds } = await buildChain();
    await manager.update({ id: sp.id, updates: { content: "changed" } });

    const first = await manager.confirm({ id: sp.id });
    expect(first.links).toHaveLength(1);
    // spec is settled, so its child can now be confirmed
    await manager.confirm({ id: ds.id });
    expect((await manager.check()).ok).toBe(true);
  });

  test("changing the child instead of confirming moves the drift down one level", async () => {
    const { sp, ds, im } = await buildChain();
    await manager.update({ id: sp.id, updates: { content: "changed" } });
    await manager.confirm({ id: sp.id });
    await manager.update({ id: ds.id, updates: { content: "adapted" } });
    await manager.confirm({ id: ds.id });

    const report = await manager.check();
    expect(kinds(report)).toEqual(["parent_changed"]);
    expect(report.findings[0].id).toBe(im.id);
  });

  test("can confirm a single parent link", async () => {
    const { rq, sp } = await buildChain();
    const other = await manager.create({ type: "requirement", title: "Audit", content: "x", requires: (await manager.list("philosophy"))[0].id });
    await manager.link({ id: sp.id, parentId: other.id });
    await manager.update({ id: rq.id, updates: { content: "changed" } });
    await manager.update({ id: other.id, updates: { content: "changed" } });
    await manager.confirm({ id: rq.id });
    await manager.confirm({ id: other.id });

    const result = await manager.confirm({ id: sp.id, target: rq.id });
    expect(result.links).toEqual([rq.id]);
    const remaining = (await manager.check()).findings.filter(f => f.id === sp.id);
    expect(remaining).toEqual([expect.objectContaining({ kind: "parent_changed", parentId: other.id })]);
  });

  test("rejects a target that is not a parent", async () => {
    const { ph, sp } = await buildChain();
    await expect(manager.confirm({ id: sp.id, target: ph.id })).rejects.toThrow("is not linked to");
  });

  test("rejects an unknown document", async () => {
    await expect(manager.confirm({ id: "nope" })).rejects.toThrow('"nope" not found');
  });

  test("records baselines for a document that has none", async () => {
    const { ph } = await buildChain();
    const doc = await manager.read(ph.id);
    expect(await manager.confirm({ id: (doc as Document).id })).toMatchObject({ links: [], code: [] });
  });
});

describe("drift against code", () => {
  test("a code change starts the walk up at the implementation", async () => {
    const { ph, im } = await buildChain();
    writeCode("src/auth.ts", "export const auth = 2;\n");

    const report = await manager.check();
    expect(kinds(report)).toEqual(["code_changed"]);
    const escalation = report.escalations[0];
    expect(escalation).toMatchObject({ document: { id: im.id }, actionable: true });
    expect(escalation.ancestors.at(-1)?.id).toBe(ph.id);
  });

  test("adding or renaming a file under a bound directory is a change", async () => {
    await buildChain();
    writeCode("src/extra.ts", "x");
    expect(kinds(await manager.check())).toEqual(["code_changed"]);
  });

  test("confirming the code clears it", async () => {
    const { im } = await buildChain();
    writeCode("src/auth.ts", "changed");
    const result = await manager.confirm({ id: im.id, target: "code" });
    expect(result.code).toEqual(["src"]);
    expect((await manager.check()).ok).toBe(true);
  });

  test("code cannot be confirmed while the document's own links are unresolved", async () => {
    const { im } = await buildChain();
    writeCode("src/auth.ts", "changed");
    await manager.update({ id: im.id, updates: { content: "rewritten" } });
    await expect(manager.confirm({ id: im.id, target: "code" })).rejects.toThrow("before its code");
    // Confirming everything at once does links first, then code
    await manager.confirm({ id: im.id });
    expect((await manager.check()).ok).toBe(true);
  });

  test("code that disappeared is code_missing", async () => {
    await buildChain();
    rmSync(path.join(root, "src"), { recursive: true });
    expect(kinds(await manager.check())).toEqual(["code_missing"]);
  });

  test("a code path written by hand without a hash is unreviewed until confirmed", async () => {
    const { im } = await buildChain();
    const file = (await manager.read(im.id) as Document).filePath;
    writeFileSync(file, readFileSync(file, "utf-8").replace(/\n {4}hash: \w+/, ""));
    expect(kinds(await manager.check())).toEqual(["code_unreviewed"]);
    await manager.baseline();
    expect((await manager.check()).ok).toBe(true);
  });

  test("globs and single files can be bound", async () => {
    const { im } = await buildChain();
    writeCode("lib/a.ts", "a");
    writeCode("lib/b.js", "b");
    const doc = await manager.bindCode({ id: im.id, paths: ["lib/*.ts", "lib/b.js"], replace: true });
    expect(doc.code?.map(c => c.path)).toEqual(["lib/*.ts", "lib/b.js"]);
    writeCode("lib/b.js", "changed");
    expect((await manager.check()).findings).toEqual([expect.objectContaining({ kind: "code_changed", path: "lib/b.js" })]);
  });

  test("re-binding a path replaces its hash, keeping the others", async () => {
    const { im } = await buildChain();
    writeCode("lib/a.ts", "a");
    await manager.bindCode({ id: im.id, paths: ["lib/a.ts"] });
    const doc = await manager.bindCode({ id: im.id, paths: ["src"] });
    expect(doc.code?.map(c => c.path)).toEqual(["lib/a.ts", "src"]);
  });

  test("binding is refused for types that do not bind code, and for paths with no files", async () => {
    const { ds, im } = await buildChain();
    await expect(manager.bindCode({ id: ds.id, paths: ["src"] })).rejects.toThrow('Type "design" does not bind code. Types that do: implementation, test');
    await expect(manager.bindCode({ id: im.id, paths: ["nothing/here"] })).rejects.toThrow("matches no files");
    await expect(manager.bindCode({ id: "nope", paths: ["src"] })).rejects.toThrow("not found");
  });
});

describe("impact", () => {
  test("for a document lists everything up to the root and everything below", async () => {
    const { ph, rq, sp, ds, im } = await buildChain();
    const report = await manager.impact({ id: sp.id });
    expect(report.subjects.map(s => s.id)).toEqual([sp.id]);
    expect(report.upstream.map(s => s.id)).toEqual([rq.id, ph.id]);
    expect(report.downstream.map(s => s.id)).toEqual([ds.id, im.id]);
  });

  test("for a code path resolves to the documents bound to it", async () => {
    const { im, ds } = await buildChain();
    expect((await manager.impact({ path: "src/auth.ts" })).subjects.map(s => s.id)).toEqual([im.id]);
    expect((await manager.impact({ path: "./src/" })).subjects.map(s => s.id)).toEqual([im.id]);
    expect((await manager.impact({ path: "src" })).upstream[0].id).toBe(ds.id);
    expect((await manager.impact({ path: "elsewhere.ts" })).subjects).toEqual([]);
  });

  test("needs a known id or a path", async () => {
    await expect(manager.impact({ id: "nope" })).rejects.toThrow("not found");
    await expect(manager.impact({})).rejects.toThrow("either id or path");
  });
});

describe("links", () => {
  test("a document can realize several parents", async () => {
    const { ph, rq } = await buildChain();
    const other = await manager.create({ type: "requirement", title: "Audit", content: "x", requires: ph.id });
    const sp = await manager.create({ type: "spec", title: "Both", content: "x", requires: [rq.id, other.id] });
    expect(sp.requires).toEqual([rq.id, other.id]);
    expect((await manager.trace({ id: sp.id, direction: "up" }))?.children.map(c => c.id)).toEqual([rq.id, other.id]);
  });

  test("a link that would make a cycle is refused", async () => {
    const { sp } = await buildChain();
    const test1 = await manager.create({ type: "test", title: "T", content: "x", requires: sp.id });
    await expect(manager.link({ id: test1.id, parentId: test1.id })).rejects.toThrow();
  });

  test("a link that would make a cycle through descendants is refused", async () => {
    const config = getDefaultConfig(path.join(root, "notes"));
    config.types = { note: { requires: ["note", "topic"] }, topic: { requires: null } };
    const notes = new ChainManager(config);
    const topic = await notes.create({ type: "topic", title: "T", content: "x" });
    const a = await notes.create({ type: "note", title: "A", content: "x", requires: topic.id });
    const b = await notes.create({ type: "note", title: "B", content: "x", requires: a.id });
    await expect(notes.link({ id: a.id, parentId: b.id })).rejects.toThrow("would make a cycle");
    await expect(notes.link({ id: a.id, parentId: a.id })).rejects.toThrow("would make a cycle");
  });

  test("unlink keeps at least one parent", async () => {
    const { ph, rq, sp } = await buildChain();
    await expect(manager.unlink({ id: sp.id, parentId: rq.id })).rejects.toThrow("must keep at least one parent");
    const other = await manager.create({ type: "requirement", title: "Other", content: "x", requires: ph.id });
    await manager.link({ id: sp.id, parentId: other.id });
    const moved = await manager.unlink({ id: sp.id, parentId: rq.id });
    expect(moved.requires).toBe(other.id);
    expect(Object.keys(moved.baseline ?? {})).toEqual([other.id]);
    expect((await manager.check()).findings.filter(f => f.id === sp.id)).toEqual([]);
  });

  test("unlink rejects unknown documents and links", async () => {
    const { ph, sp } = await buildChain();
    await expect(manager.unlink({ id: "nope", parentId: ph.id })).rejects.toThrow("not found");
    await expect(manager.unlink({ id: sp.id, parentId: ph.id })).rejects.toThrow("is not linked to");
  });
});

describe("structural findings", () => {
  function writeDoc(type: string, id: string, meta: string): void {
    const dir = path.join(root, "docs/chain", type);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, `${id}.md`), `---\nid: ${id}\ntype: ${type}\ntitle: ${id}\ncreated: x\nupdated: x\n${meta}---\n\nbody\n`);
  }

  test("cycles, wrong parents, unknown types and broken files are all reported", async () => {
    writeDoc("spec", "A", "requires: B\n");
    writeDoc("spec", "B", "requires: A\n");
    writeDoc("philosophy", "P", "requires: A\n");
    writeDoc("weird", "W", "");
    writeDoc("design", "D", "requires: GONE\n");
    writeFileSync(path.join(root, "docs/chain/spec/broken.md"), "no frontmatter");

    const report = await manager.check();
    const byId = (id: string) => kinds(report, id);
    expect(byId("A")).toEqual(expect.arrayContaining(["cycle", "invalid_parent_type", "unreviewed_link"]));
    expect(byId("P")).toEqual(expect.arrayContaining(["root_has_parent"]));
    expect(byId("W")).toEqual(["unknown_type"]);
    expect(byId("D")).toEqual(["parent_not_found", "unrealized"]);
    expect(report.findings.some(f => f.kind === "invalid_file" && f.id.endsWith("broken.md"))).toBe(true);
    // Trace stops at the cycle instead of recursing forever
    const tree = await manager.trace({ id: "A", direction: "up" });
    expect(tree?.suspect).toBe(true);
    expect(tree?.children[0].children).toEqual([]);
  });

  test("baseline adopts legacy documents without hiding visible drift", async () => {
    writeDoc("philosophy", "P", "");
    writeDoc("requirement", "R", "requires: P\n");
    expect(kinds(await manager.check(), "R")).toEqual(["unrealized", "unreviewed_link"]);
    expect(await manager.baseline()).toEqual({ links: 1, code: 0 });
    expect(kinds(await manager.check(), "R")).toEqual(["unrealized"]);
    // Nothing left to adopt the second time
    expect(await manager.baseline()).toEqual({ links: 0, code: 0 });
  });
});
