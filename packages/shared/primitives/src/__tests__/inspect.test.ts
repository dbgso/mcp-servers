import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createInspectionOp, type InspectCtx } from "../ops/inspect.js";
import type { Inspector, Whitelist, LimitPolicy } from "../interfaces/index.js";

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: (n) => n ?? 10 };

function makeWhitelist(names: string[]): Whitelist {
  const set = new Set(names);
  return { listContainers: () => [...names].sort(), hasContainer: (n): n is string => set.has(n) };
}

function makeCtx(inspector: Inspector, names: string[] = ["users"]): InspectCtx {
  return {
    whitelist: makeWhitelist(names),
    reader: {},
    limit,
    trait: (name) => (name === "inspector" ? inspector : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ table: z.string().optional() });
type Args = z.infer<typeof argsSchema>;
type Result = { rows: number };
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createInspectionOp<Args, InspectCtx, Result, Tag>>[0]>) {
  return createInspectionOp<Args, InspectCtx, Result, Tag>({
    id: "table_stats",
    summary: "stats",
    detail: "table stats",
    argsSchema,
    invoke: ({ args, ctx }) => (ctx.trait("inspector").getTableStats as ((i: { table?: string }) => Promise<Result | undefined>) | undefined)?.({ table: args.table }),
    respond: {
      ok: ({ result }) => ({ kind: "ok", result }),
      notSupported: ({ opId }) => ({ kind: "notSupported", opId }),
      containerNotWhitelisted: ({ container, available }) => ({ kind: "containerNotWhitelisted", container, available }),
      error: ({ message }) => ({ kind: "error", message }),
    },
    ...extra,
  });
}

describe("createInspectionOp — engine-state read", () => {
  it("id/category + requires", () => {
    const op = makeOp();
    expect(op.id).toBe("table_stats");
    expect(op.category).toBe("Inspection");
    expect(op.requires).toEqual({ extras: ["inspector"] });
  });

  it("ok when the inspector method returns a result", async () => {
    const r = await makeOp().execute({ args: {}, ctx: makeCtx({ getTableStats: vi.fn(async () => ({ rows: 42 })) }) });
    expect(r).toEqual({ kind: "ok", result: { rows: 42 } });
  });

  it("notSupported when the inspector method is absent (invoke → undefined)", async () => {
    const r = await makeOp().execute({ args: {}, ctx: makeCtx({}) });
    expect(r).toEqual({ kind: "notSupported", opId: "table_stats" });
  });

  it("error when the inspector method throws", async () => {
    const r = await makeOp().execute({ args: {}, ctx: makeCtx({ getTableStats: vi.fn(async () => { throw new Error("engine down"); }) }) });
    expect(r).toEqual({ kind: "error", message: "engine down" });
  });

  it("containerNotWhitelisted when extractContainer targets a non-whitelisted container (inspector never invoked)", async () => {
    const spy = vi.fn(async () => ({ rows: 1 }));
    const r = await makeOp({ extractContainer: (a) => a.table }).execute({ args: { table: "secrets" }, ctx: makeCtx({ getTableStats: spy }) });
    expect(r).toEqual({ kind: "containerNotWhitelisted", container: "secrets", available: ["users"] });
    expect(spy).not.toHaveBeenCalled();
  });

  it("proceeds when extractContainer targets a whitelisted container", async () => {
    const r = await makeOp({ extractContainer: (a) => a.table }).execute({ args: { table: "users" }, ctx: makeCtx({ getTableStats: vi.fn(async () => ({ rows: 7 })) }) });
    expect(r).toEqual({ kind: "ok", result: { rows: 7 } });
  });

  it("throws if extractContainer is set but respond.containerNotWhitelisted is missing", async () => {
    const op = makeOp({ extractContainer: (a) => a.table, respond: {
      ok: ({ result }) => ({ kind: "ok", result }),
      notSupported: ({ opId }) => ({ kind: "notSupported", opId }),
      error: ({ message }) => ({ kind: "error", message }),
    } });
    await expect(op.execute({ args: { table: "secrets" }, ctx: makeCtx({}) })).rejects.toThrow(/containerNotWhitelisted is not defined/);
  });
});
