import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createContainerReadOp, type ContainerReadCtx } from "../ops/container-read.js";
import type { ContainerAccess, PointReader, Redactor, LimitPolicy } from "../interfaces/index.js";

type Rec = { body: string; secret?: string };

// ContainerAccess double: containers is a map name -> allowed item prefixes.
function makeAccess(containers: Record<string, string[]>): ContainerAccess {
  const has = (n: string): n is string => Object.prototype.hasOwnProperty.call(containers, n);
  return {
    listContainers: () => Object.keys(containers).sort(),
    hasContainer: has,
    isItemAllowed: ({ container, item }) =>
      has(container) && !item.includes("..") && containers[container].some((p) => item.startsWith(p)),
    getContainerLimits: () => undefined,
  };
}

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: (n) => Math.min(n ?? 10, 50) };

function makeCtx(opts: { store?: Record<string, Rec>; access?: ContainerAccess } = {}): ContainerReadCtx<Rec> {
  const reader: PointReader<string, string, Rec> = {
    readOne: vi.fn(async ({ container, key }) => opts.store?.[`${container}:${key}`] ?? null),
  };
  const redactor: Redactor<string, Rec> = {
    redactOne: ({ record }) => ({ ...record, secret: record.secret === undefined ? undefined : "[R]" }),
    redactMany: ({ records }) => records.map((r) => ({ ...r, secret: r.secret === undefined ? undefined : "[R]" })),
  };
  return {
    whitelist: opts.access ?? makeAccess({ bucket: ["ok/"] }),
    reader,
    limit,
    trait: (name) => (name === "redactor" ? redactor : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ container: z.string(), key: z.string() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createContainerReadOp<Args, ContainerReadCtx<Rec>, Tag, Rec, string>>[0]>) {
  return createContainerReadOp<Args, ContainerReadCtx<Rec>, Tag, Rec, string>({
    argsSchema,
    extractContainer: (a) => a.container,
    extractKey: (a) => a.key,
    respond: {
      ok: ({ container, key, record }) => ({ kind: "ok", container, key, record }),
      notFound: ({ key }) => ({ kind: "notFound", key }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
      itemNotAllowed: ({ key }) => ({ kind: "itemNotAllowed", key }),
    },
    ...extra,
  });
}
const baseArgs = { container: "bucket", key: "ok/file.txt" };

describe("createContainerReadOp — opaque container flow", () => {
  it("id + requires (redactor extra only when applyRedactor)", () => {
    expect(makeOp().id).toBe("container_read");
    expect(makeOp().requires).toEqual({ reader: ["PointReader"], extras: [] });
    expect(makeOp({ applyRedactor: true }).requires).toEqual({ reader: ["PointReader"], extras: ["redactor"] });
  });

  it("preContainerGate short-circuits before the container gate", async () => {
    const reject: Tag = { kind: "derivationFailed" };
    const ctx = makeCtx();
    const r = await makeOp({ preContainerGate: () => reject }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.reader.readOne).not.toHaveBeenCalled();
  });

  it("notWhitelisted for an unknown container", async () => {
    const r = await makeOp().execute({ args: { container: "other", key: "ok/x" }, ctx: makeCtx() });
    expect(r).toEqual({ kind: "notWhitelisted", container: "other", available: ["bucket"] });
  });

  it("itemNotAllowed: prefix miss and path traversal both rejected", async () => {
    expect((await makeOp().execute({ args: { container: "bucket", key: "denied/x" }, ctx: makeCtx() })).kind).toBe("itemNotAllowed");
    expect((await makeOp().execute({ args: { container: "bucket", key: "ok/../etc" }, ctx: makeCtx() })).kind).toBe("itemNotAllowed");
  });

  it("preHook short-circuits after the item gate, before the reader", async () => {
    const reject: Tag = { kind: "blocked" };
    const ctx = makeCtx({ store: { "bucket:ok/file.txt": { body: "hi" } } });
    const r = await makeOp({ preHooks: [() => reject] }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.reader.readOne).not.toHaveBeenCalled();
  });

  it("notFound when reader yields null; reader gets empty field projection", async () => {
    const ctx = makeCtx({ store: {} });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("notFound");
    expect((ctx.reader.readOne as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]).toMatchObject({ container: "bucket", key: "ok/file.txt", fields: [] });
  });

  it("ok passes the raw payload through unchanged when applyRedactor is off", async () => {
    const ctx = makeCtx({ store: { "bucket:ok/file.txt": { body: "hi", secret: "s" } } });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect(r.record).toEqual({ body: "hi", secret: "s" }); // not redacted
  });

  it("ok applies redactor when applyRedactor is on", async () => {
    const ctx = makeCtx({ store: { "bucket:ok/file.txt": { body: "hi", secret: "s" } } });
    const r = await makeOp({ applyRedactor: true }).execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect(r.record).toEqual({ body: "hi", secret: "[R]" });
  });
});
