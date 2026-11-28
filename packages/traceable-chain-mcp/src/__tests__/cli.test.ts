import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { runCli } from "../cli.js";
import { loadConfig } from "../config.js";
import { ChainManager } from "../chain-manager.js";
import { ChainMutateHandler, ChainQueryHandler } from "../tools/handlers/index.js";

let root: string;

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await runCli({ argv, cwd: root, io: { out: t => out.push(t), err: t => err.push(t) } });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function seed(): Promise<Record<string, string>> {
  const manager = new ChainManager(loadConfig({ cwd: root }));
  const ph = await manager.create({ type: "philosophy", title: "P", content: "x" });
  const rq = await manager.create({ type: "requirement", title: "R", content: "x", requires: ph.id });
  const sp = await manager.create({ type: "spec", title: "S", content: "x", requires: rq.id });
  const ds = await manager.create({ type: "design", title: "D", content: "x", requires: sp.id });
  const im = await manager.create({ type: "implementation", title: "I", content: "x", requires: ds.id });
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "src/a.ts"), "a");
  return { ph: ph.id, rq: rq.id, sp: sp.id, ds: ds.id, im: im.id };
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "chain-cli-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("CLI", () => {
  test("help and unknown commands", async () => {
    expect((await cli("--help")).code).toBe(0);
    expect((await cli()).out).toContain("Usage: traceable-chain");
    expect((await cli("frobnicate")).code).toBe(2);
  });

  test("check fails on drift and names the walk up", async () => {
    const ids = await seed();
    expect((await cli("bind", ids.im, "src")).out).toContain("Bound implementation");
    const clean = await cli("check");
    expect(clean).toMatchObject({ code: 0 });
    expect(clean.out).toContain("✓ 0 error(s), 0 warning(s)");

    writeFileSync(path.join(root, "src/a.ts"), "b");
    const dirty = await cli("check");
    expect(dirty.code).toBe(1);
    expect(dirty.out).toContain("code_changed");
    expect(dirty.out).toContain(`▶ implementation "I" (${ids.im})`);
    expect(dirty.out).toContain(`↑ philosophy "P" (${ids.ph})`);

    const json = JSON.parse((await cli("check", "--json")).out);
    expect(json.escalations[0].document.id).toBe(ids.im);

    expect((await cli("confirm", ids.im, "--target", "code")).out).toContain("1 code path(s)");
    expect((await cli("confirm", ids.im, "--json")).out).toContain('"links"');
    expect((await cli("check")).code).toBe(0);
  });

  test("--strict also fails on warnings", async () => {
    await seed();
    const result = await cli("check", "--strict");
    expect(result.code).toBe(1);
    expect(result.out).toContain("no_code");
    expect(result.out).toContain("Warnings");
  });

  test("confirm refuses below an unresolved decision", async () => {
    const ids = await seed();
    const manager = new ChainManager(loadConfig({ cwd: root }));
    await manager.update({ id: ids.rq, updates: { content: "changed" } });
    const result = await cli("confirm", ids.ds);
    expect(result.code).toBe(2);
    expect(result.err).toContain("Resolve the upper decision first");
  });

  test("impact, trace and list", async () => {
    const ids = await seed();
    await cli("bind", ids.im, "src");
    const byPath = await cli("impact", "src/a.ts");
    expect(byPath.out).toContain("Must still satisfy");
    expect(byPath.out).toContain(`philosophy "P"`);
    const byId = await cli("impact", ids.sp);
    expect(byId.out).toContain("Can invalidate");
    expect(JSON.parse((await cli("impact", ids.sp, "--json")).out).downstream).toHaveLength(2);

    const down = await cli("trace", ids.ph);
    expect(down.out.split("\n")).toHaveLength(5);
    expect((await cli("trace", ids.im, "--up")).out).toContain(`└ design "D"`);
    expect(JSON.parse((await cli("trace", ids.ph, "--json")).out).id).toBe(ids.ph);
    expect((await cli("trace", "nope")).code).toBe(2);

    expect((await cli("list", "--type", "spec")).out).toContain("S");
    expect(JSON.parse((await cli("list", "--json")).out)).toHaveLength(5);
    expect((await cli("list", "--type", "spec", "--dir", "elsewhere")).out).toBe("(no documents)");
  });

  test("check shows broken files and documents that must wait for the level above", async () => {
    const ids = await seed();
    const manager = new ChainManager(loadConfig({ cwd: root }));
    await manager.update({ id: ids.sp, updates: { content: "changed" } });
    writeFileSync(path.join(root, "docs/chain/spec/broken.md"), "nope");
    const out = (await cli("check")).out;
    expect(out).toContain("invalid_file");
    expect(out).toContain(`    design "D" (${ids.ds})`);
    expect(out).toContain(`▶ spec "S" (${ids.sp})`);
  });

  test("trace marks suspect documents", async () => {
    const ids = await seed();
    const manager = new ChainManager(loadConfig({ cwd: root }));
    await manager.update({ id: ids.sp, updates: { content: "changed" } });
    expect((await cli("trace", ids.ph)).out).toContain(`spec "S" (${ids.sp}) ⚠`);
  });

  test("link, unlink and baseline", async () => {
    const ids = await seed();
    const manager = new ChainManager(loadConfig({ cwd: root }));
    const other = await manager.create({ type: "requirement", title: "R2", content: "x", requires: ids.ph });
    expect((await cli("link", ids.sp, other.id)).out).toContain("Linked spec");
    expect((await cli("unlink", ids.sp, ids.rq)).out).toContain("Unlinked spec");
    expect((await cli("baseline")).out).toContain("0 link(s)");
    expect((await cli("bind", ids.im, "src", "--json")).out).toContain('"path": "src"');
  });

  test("missing arguments print usage as an error", async () => {
    const result = await cli("confirm");
    expect(result.code).toBe(2);
    expect(result.err).toContain("Usage: traceable-chain confirm");
  });
});

describe("loadConfig", () => {
  test("reads a config file and resolves its paths against the file", async () => {
    mkdirSync(path.join(root, "conf"));
    writeFileSync(path.join(root, "conf/chain.config.yaml"), [
      "types:",
      "  goal: { requires: null }",
      "  task: { requires: goal, bindsCode: true }",
      "storage: { basePath: ../decisions }",
      "codeRoot: ..",
    ].join("\n"));
    const config = loadConfig({ cwd: root, configPath: "conf/chain.config.yaml" });
    expect(config.storage.basePath).toBe(path.join(root, "decisions"));
    expect(config.codeRoot).toBe(root);
    expect(Object.keys(config.types)).toEqual(["goal", "task"]);
  });

  test("finds a config in the working directory and lets --dir override the base path", async () => {
    writeFileSync(path.join(root, ".chain.json"), JSON.stringify({ types: { a: { requires: null } } }));
    const logs: string[] = [];
    const config = loadConfig({ cwd: root, basePath: "x", log: m => logs.push(m) });
    expect(config.storage.basePath).toBe(path.join(root, "x"));
    expect(logs[0]).toContain(".chain.json");
  });

  test("a config file that does not exist is an error", () => {
    expect(() => loadConfig({ cwd: root, configPath: "nope.yaml" })).toThrow("Config file not found");
  });

  test("the default starts from philosophy", () => {
    const config = loadConfig({ cwd: root });
    expect(config.types.philosophy.requires).toBeNull();
    expect(config.types.requirement.requires).toBe("philosophy");
    expect(config.codeRoot).toBe(root);
  });
});

describe("MCP operations", () => {
  test("describe lists what realizes each type and which types bind code", async () => {
    const { ChainDescribeHandler } = await import("../tools/handlers/index.js");
    const handler = new ChainDescribeHandler(new ChainManager(loadConfig({ cwd: root })));
    const text = (await handler.execute({})).content[0].text as string;
    expect(text).toContain("**philosophy**: requires (root) (realized by requirement)");
    expect(text).toContain("**implementation**: requires design (binds code)");
    expect(text).toContain("**proposal**: requires philosophy | requirement");
  });

  test("check, impact, confirm, bind_code, unlink and baseline are reachable through the tools", async () => {
    const ids = await seed();
    const manager = new ChainManager(loadConfig({ cwd: root }));
    const query = new ChainQueryHandler(manager);
    const mutate = new ChainMutateHandler(manager);
    const text = (r: { content: { text?: string }[] }) => r.content[0].text as string;

    const bound = await mutate.execute({ operation: "bind_code", params: { id: ids.im, paths: ["src"] } });
    expect(JSON.parse(text(bound)).document.code[0].path).toBe("src");

    await manager.update({ id: ids.sp, updates: { content: "changed" } });
    const check = JSON.parse(text(await query.execute({ operation: "check" })));
    expect(check.ok).toBe(false);

    const impact = JSON.parse(text(await query.execute({ operation: "impact", params: { path: "src" } })));
    expect(impact.subjects[0].id).toBe(ids.im);

    const refused = await mutate.execute({ operation: "confirm", params: { id: ids.ds } });
    expect(refused.isError).toBe(true);
    const confirmed = await mutate.execute({ operation: "confirm", params: { id: ids.sp } });
    expect(JSON.parse(text(confirmed)).links).toEqual([ids.rq]);

    const other = await manager.create({ type: "requirement", title: "R2", content: "x", requires: ids.ph });
    await mutate.execute({ operation: "link", params: { id: ids.sp, parent_id: other.id } });
    const unlinked = await mutate.execute({ operation: "unlink", params: { id: ids.sp, parent_id: other.id } });
    expect(JSON.parse(text(unlinked)).document.requires).toBe(ids.rq);

    const baseline = await mutate.execute({ operation: "baseline", params: {} });
    expect(JSON.parse(text(baseline)).links).toBe(0);

    const created = await mutate.execute({ operation: "create", params: { type: "spec", title: "Multi", content: "x", requires: [ids.rq, other.id] } });
    expect(JSON.parse(text(created)).document.requires).toEqual([ids.rq, other.id]);
  });
});
