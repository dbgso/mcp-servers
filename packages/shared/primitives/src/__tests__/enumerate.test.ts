import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { createEnumerateOp, type EnumerateCtx } from "../ops/enumerate.js";
import type { ContainerAccess, Enumerator, EnumeratePage, LimitPolicy } from "../interfaces/index.js";

function makeAccess(names: string[]): ContainerAccess {
  const set = new Set(names);
  return {
    listContainers: () => [...names].sort(),
    hasContainer: (n): n is string => set.has(n),
    isItemAllowed: () => true,
    getContainerLimits: () => undefined,
  };
}

const limit: LimitPolicy = { defaultLimit: 10, maxLimit: 50, clamp: vi.fn((n?: number) => Math.min(n ?? 10, 50)) };

function makeCtx(page: EnumeratePage<string>, access?: ContainerAccess): EnumerateCtx<string> {
  const enumerator: Enumerator<string, string> = { enumerate: vi.fn(async () => page) };
  return {
    whitelist: access ?? makeAccess(["bucket"]),
    reader: {},
    limit,
    trait: (name) => (name === "enumerator" ? enumerator : (() => { throw new Error(String(name)); })()) as never,
  };
}

const argsSchema = z.object({ container: z.string(), prefix: z.string().optional(), cursor: z.string().optional(), limit: z.number().optional() });
type Args = z.infer<typeof argsSchema>;
type Tag = { kind: string; [k: string]: unknown };

function makeOp(extra?: Partial<Parameters<typeof createEnumerateOp<Args, EnumerateCtx<string>, Tag, string>>[0]>) {
  return createEnumerateOp<Args, EnumerateCtx<string>, Tag, string>({
    argsSchema,
    extractContainer: (a) => a.container,
    extractFilter: (a) => ({ prefix: a.prefix }),
    extractCursor: (a) => a.cursor,
    extractLimit: (a) => a.limit,
    respond: {
      ok: ({ container, items, itemCount, nextCursor, meta, limit: lim, filter }) => ({ kind: "ok", container, items, itemCount, nextCursor, meta, limit: lim, filter }),
      notWhitelisted: ({ container, available }) => ({ kind: "notWhitelisted", container, available }),
    },
    ...extra,
  });
}
const baseArgs = { container: "bucket", prefix: "logs/" };

describe("createEnumerateOp — bulk enumeration flow", () => {
  it("id + requires (enumerator extra, no reader)", () => {
    expect(makeOp().id).toBe("enumerate");
    expect(makeOp().requires).toEqual({ extras: ["enumerator"] });
  });

  it("preContainerGate short-circuits before the container gate", async () => {
    const reject: Tag = { kind: "derivationFailed" };
    const ctx = makeCtx({ items: [] });
    const r = await makeOp({ preContainerGate: () => reject }).execute({ args: baseArgs, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("enumerator").enumerate).not.toHaveBeenCalled();
  });

  it("notWhitelisted for an unknown container", async () => {
    const r = await makeOp().execute({ args: { container: "other" }, ctx: makeCtx({ items: [] }) });
    expect(r).toEqual({ kind: "notWhitelisted", container: "other", available: ["bucket"] });
  });

  it("preHook short-circuits after clamp, before the enumerator", async () => {
    const reject: Tag = { kind: "prefixDisallowed" };
    const ctx = makeCtx({ items: [] });
    const r = await makeOp({ preHooks: [({ limit: lim }) => (lim === 50 ? reject : null)] }).execute({ args: { ...baseArgs, limit: 999 }, ctx });
    expect(r).toBe(reject);
    expect(ctx.trait("enumerator").enumerate).not.toHaveBeenCalled();
  });

  it("clamps limit and passes filter/cursor to the enumerator", async () => {
    const ctx = makeCtx({ items: ["logs/a", "logs/b"] });
    await makeOp().execute({ args: { ...baseArgs, cursor: "c1", limit: 999 }, ctx });
    const call = (ctx.trait("enumerator").enumerate as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0];
    expect(call).toEqual({ container: "bucket", filter: { prefix: "logs/" }, cursor: "c1", limit: 50 });
  });

  it("ok threads items/itemCount/nextCursor/meta verbatim", async () => {
    const ctx = makeCtx({ items: ["logs/a", "logs/b"], nextCursor: "c2", meta: { isTruncated: true } });
    const r = await makeOp().execute({ args: baseArgs, ctx });
    expect(r.kind).toBe("ok");
    expect(r.items).toEqual(["logs/a", "logs/b"]);
    expect(r.itemCount).toBe(2);
    expect(r.nextCursor).toBe("c2");
    expect(r.meta).toEqual({ isTruncated: true });
  });
});
