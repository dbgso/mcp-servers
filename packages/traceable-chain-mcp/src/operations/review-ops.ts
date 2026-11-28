import { z } from "zod";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Operation, OperationContext } from "./types.js";
import { respondJson } from "./respond.js";

// ─── unlink ───────────────────────────────────────────────────────────────

const unlinkArgsSchema = z.object({
  id: z.string().describe("Document ID"),
  parent_id: z.string().describe("Parent document ID to remove"),
});
type UnlinkArgs = z.infer<typeof unlinkArgsSchema>;

export class UnlinkOp implements Operation<UnlinkArgs> {
  readonly id = "unlink";
  readonly summary = "Remove a parent link";
  readonly detail = `Remove one parent link from a document. A non-root document must keep at
least one parent, so to move a document, link the new parent first, then unlink the old one.

Examples:
  operation: "unlink"
  params: { id: "01HQXK3V7M...", parent_id: "01HQXK2A8N..." }`;
  readonly argsSchema = unlinkArgsSchema;
  async execute(args: UnlinkArgs, ctx: OperationContext): Promise<CallToolResult> {
    return respondJson(async () => {
      const doc = await ctx.manager.unlink({ id: args.id, parentId: args.parent_id });
      return { message: "Link removed", document: { id: doc.id, type: doc.type, title: doc.title, requires: doc.requires } };
    });
  }
}

// ─── confirm ──────────────────────────────────────────────────────────────

const confirmArgsSchema = z.object({
  id: z.string().describe("Document ID to confirm"),
  target: z.string().optional()
    .describe("A parent ID to confirm only that link, or \"code\" to confirm only the code. Omit to confirm everything."),
});
type ConfirmArgs = z.infer<typeof confirmArgsSchema>;

export class ConfirmOp implements Operation<ConfirmArgs> {
  readonly id = "confirm";
  readonly summary = "Confirm a document still holds after a change";
  readonly detail = `Record that a document still holds against its parents and its code as they
are now. This clears parent_changed / self_changed / unreviewed_link on its links and
code_changed / code_unreviewed on its code.

Confirm only after actually re-reading both sides. If the document does NOT hold,
update it instead; that change then has to be confirmed against the level above, and
so on up to the root.

Resolution is top-down: confirm fails while anything above the document is still
unresolved, and names the upper document to settle first. Code sits below the
document, so target "code" also requires the document's own links to be resolved.

Examples:
  operation: "confirm"
  params: { id: "01HQXK4B9P..." }
  params: { id: "01HQXK4B9P...", target: "01HQXK3V7M..." }
  params: { id: "01HQXK5C0Q...", target: "code" }`;
  readonly argsSchema = confirmArgsSchema;
  async execute(args: ConfirmArgs, ctx: OperationContext): Promise<CallToolResult> {
    return respondJson(async () => {
      const result = await ctx.manager.confirm({ id: args.id, target: args.target });
      return { message: "Confirmed", ...result };
    });
  }
}

// ─── bind_code ────────────────────────────────────────────────────────────

const bindCodeArgsSchema = z.object({
  id: z.string().describe("Document ID (a type that binds code, e.g. implementation)"),
  paths: z.array(z.string()).min(1).describe("Files, directories or globs relative to the code root"),
  replace: z.boolean().optional().describe("Replace all existing code paths instead of adding (default false)"),
});
type BindCodeArgs = z.infer<typeof bindCodeArgsSchema>;

export class BindCodeOp implements Operation<BindCodeArgs> {
  readonly id = "bind_code";
  readonly summary = "Bind a document to source code";
  readonly detail = `Point a document at the code that realizes it. Each path is hashed as it is
bound; when the code changes later, check reports code_changed on this document,
which starts the walk back up the chain.

Paths are relative to the code root (the directory of the config file, or the
working directory). A directory covers every file under it.

Examples:
  operation: "bind_code"
  params: { id: "01HQXK5C0Q...", paths: ["packages/foo/src/auth.ts", "packages/foo/src/auth/"] }`;
  readonly argsSchema = bindCodeArgsSchema;
  async execute(args: BindCodeArgs, ctx: OperationContext): Promise<CallToolResult> {
    return respondJson(async () => {
      const doc = await ctx.manager.bindCode({ id: args.id, paths: args.paths, replace: args.replace });
      return { message: "Code bound", document: { id: doc.id, type: doc.type, title: doc.title, code: doc.code } };
    });
  }
}

// ─── baseline ─────────────────────────────────────────────────────────────

const baselineArgsSchema = z.object({});
type BaselineArgs = z.infer<typeof baselineArgsSchema>;

export class BaselineOp implements Operation<BaselineArgs> {
  readonly id = "baseline";
  readonly summary = "Adopt existing documents (record missing baselines)";
  readonly detail = `Give every link and code path that has never been confirmed a baseline taken
from the current state. Existing baselines are not touched, so drift that is
already visible stays visible. Use once when adopting documents written before
baselines existed.

Examples:
  operation: "baseline"
  params: {}`;
  readonly argsSchema = baselineArgsSchema;
  async execute(_args: BaselineArgs, ctx: OperationContext): Promise<CallToolResult> {
    return respondJson(async () => ({ message: "Baselines recorded", ...await ctx.manager.baseline() }));
  }
}

export const reviewOperations: Operation[] = [new UnlinkOp(), new ConfirmOp(), new BindCodeOp(), new BaselineOp()];
