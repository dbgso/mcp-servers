import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { BaseToolHandler } from "./base-handler.js";
import type { Operation, OperationRegistry } from "./operation.js";
import type { ApprovalStrategy } from "../utils/approval/strategy.js";
import { errorResponse } from "../utils/mcp-response.js";
import { contentHash } from "../utils/content-hash.js";
import type { ToolResponse } from "./types.js";

function formatCategorySection<TCtx>(params: {
  category: string;
  ops: Operation<unknown, TCtx>[];
}): string[] {
  const { category, ops } = params;
  return [`## ${category}`, ...ops.map((op) => `- **${op.id}** — ${op.summary}`), ""];
}

/**
 * The listing is what a caller needs to recover from a bad id, so the available
 * ids go in the error rather than only in the describe tool.
 */
function unknownOperationError<TCtx>(params: {
  registry: OperationRegistry<TCtx>;
  operation: string;
}): ToolResponse {
  const { registry, operation } = params;
  const available = registry.all().map((o) => o.id).join(", ");
  return errorResponse(`Unknown operation: "${operation}".\nAvailable: ${available}`);
}

function invalidParamsError(params: {
  operation: string;
  error: z.ZodError;
  describeToolName: string;
}): ToolResponse {
  const { operation, error, describeToolName } = params;
  const issues = error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
  return errorResponse(
    `Invalid params for "${operation}":\n${issues}\n\n` +
      `Use \`${describeToolName}({ operation: "${operation}" })\` for the schema.`,
  );
}

/** The schema defaults `params` to `{}`; this covers a caller that bypasses it. */
function operationParams(args: { params?: Record<string, unknown> }): Record<string, unknown> {
  return args.params ?? {};
}

/**
 * Build the markdown listing of operations grouped by category.
 */
function formatOperationList<TCtx>(params: {
  registry: OperationRegistry<TCtx>;
  executeToolName: string;
  listTitle: string;
  preamble?: string;
}): string {
  const lines: string[] = [];
  if (params.preamble) {
    lines.push(params.preamble, "");
  }
  lines.push(`# ${params.listTitle}`, "");
  lines.push(
    `Use \`${params.executeToolName}\` with \`{ operation, params }\` to invoke an operation.`,
    `Call this describe tool with \`{ operation: "<id>" }\` to see one op's full schema.`,
    "",
  );

  const grouped = params.registry.byCategory();
  const categoryNames = Object.keys(grouped).sort((a, b) => a.localeCompare(b));
  for (const cat of categoryNames) {
    lines.push(...formatCategorySection({ category: cat, ops: grouped[cat] }));
  }
  return lines.join("\n");
}

/**
 * Format a single operation's detail view including its arg schema.
 */
function formatOperationDetail<TCtx>(params: {
  op: Operation<unknown, TCtx>;
  executeToolName: string;
}): ToolResponse {
  const jsonSchema = zodToJsonSchema(params.op.argsSchema, { target: "openApi3" });
  const lines = [
    `# ${params.op.id}`,
    "",
    params.op.summary,
    "",
    `**Category:** ${params.op.category ?? "Other"}`,
    `**Mutates:** ${params.op.mutates ? "yes" : "no"}`,
    "",
    params.op.detail,
    "",
    `## Invocation`,
    "",
    `Call \`${params.executeToolName}({ operation: "${params.op.id}", params: <args> })\`.`,
    "",
    `## Arg schema`,
    "",
    "```json",
    JSON.stringify(jsonSchema, null, 2),
    "```",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

/**
 * Describe-tool handler: lists ops, or shows one op's detail when `operation` is given.
 */
class DescribeHandler<TCtx> extends BaseToolHandler<{ operation?: string }> {
  readonly name: string;
  readonly description: string;
  readonly schema = z.object({
    operation: z
      .string()
      .optional()
      .describe("Operation id to inspect (omit for full listing)"),
  });
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: {
        type: "string",
        description: "Operation id to inspect (omit for full listing)",
      },
    },
  };

  constructor(
    private readonly registry: OperationRegistry<TCtx>,
    name: string,
    description: string,
    private readonly executeToolName: string,
    private readonly listTitle: string,
    private readonly preamble?: string,
  ) {
    super();
    this.name = name;
    this.description = description;
  }

  protected async doExecute(args: { operation?: string }): Promise<ToolResponse> {
    if (args.operation) {
      const op = this.registry.get(args.operation);
      if (!op) {
        return unknownOperationError({ registry: this.registry, operation: args.operation });
      }
      return formatOperationDetail({ op, executeToolName: this.executeToolName });
    }
    const text = formatOperationList({
      registry: this.registry,
      executeToolName: this.executeToolName,
      listTitle: this.listTitle,
      preamble: this.preamble,
    });
    return { content: [{ type: "text", text }] };
  }
}

/**
 * Execute-tool handler: routes `{ operation, params }` to the matching operation.
 */
class ExecuteHandler<TCtx> extends BaseToolHandler<{
  operation: string;
  params?: Record<string, unknown>;
  approvalToken?: string;
  why?: string;
}> {
  readonly name: string;
  readonly description: string;
  readonly schema = z.object({
    operation: z.string().describe("Operation id (see describe tool)"),
    params: z
      .record(z.unknown())
      .optional()
      .default({})
      .describe("Operation-specific parameters"),
    approvalToken: z
      .string()
      .optional()
      .describe(
        "Approval token for a token-gated op, read by the user from the desktop notification.",
      ),
    why: z
      .string()
      .optional()
      .describe(
        "Why this change is needed. Shown to the human approver for approval-gated ops.",
      ),
  });
  readonly inputSchema = {
    type: "object" as const,
    properties: {
      operation: { type: "string", description: "Operation id (see describe tool)" },
      params: { type: "object", description: "Operation-specific parameters" },
      approvalToken: {
        type: "string",
        description: "Approval token for a token-gated op (from the desktop notification).",
      },
      why: {
        type: "string",
        description: "Why this change is needed (shown to the human approver).",
      },
    },
    required: ["operation"],
  };

  constructor(
    private readonly registry: OperationRegistry<TCtx>,
    name: string,
    description: string,
    private readonly buildContext: (
      args: Record<string, unknown>,
    ) => Promise<TCtx> | TCtx,
    private readonly describeToolName: string,
  ) {
    super();
    this.name = name;
    this.description = description;
  }

  protected async doExecute(args: {
    operation: string;
    params?: Record<string, unknown>;
    approvalToken?: string;
    why?: string;
  }): Promise<ToolResponse> {
    const op = this.registry.get(args.operation);
    if (!op) {
      return unknownOperationError({ registry: this.registry, operation: args.operation });
    }

    const opParams = operationParams(args);
    const parsed = op.argsSchema.safeParse(opParams);
    if (!parsed.success) {
      return invalidParamsError({
        operation: args.operation,
        error: parsed.error,
        describeToolName: this.describeToolName,
      });
    }

    const ctx = await this.buildContext(opParams);
    return this.runGated({ op, args: parsed.data, ctx, execArgs: args });
  }

  /**
   * The gate and the call belong together: an approval-gated op must not reach
   * `execute` on the same pass that asks for approval.
   */
  private async runGated(params: {
    op: Operation<unknown, TCtx>;
    args: unknown;
    ctx: TCtx;
    execArgs: { approvalToken?: string; why?: string };
  }): Promise<ToolResponse> {
    const { op, args, ctx, execArgs } = params;

    // Approval gate: an approval-gated op cannot run until a human approves the
    // exact, tool-computed change. The approval is content-bound to `what`, so a
    // param change after approval invalidates it and re-prompts.
    const strategy = op.approval;
    if (strategy !== undefined) {
      const gate = await this.gateApproval({ op, strategy, args, ctx, execArgs });
      if (gate) return gate; // not yet approved → instructions returned to caller
    }

    return op.execute({ args, ctx });
  }

  /**
   * Returns a ToolResponse asking for approval when the op is not yet approved,
   * or `null` when approval is valid and execution may proceed.
   */
  private async gateApproval(params: {
    op: Operation<unknown, TCtx>;
    strategy: ApprovalStrategy;
    args: unknown;
    ctx: TCtx;
    execArgs: { approvalToken?: string; why?: string };
  }): Promise<ToolResponse | null> {
    const { op, strategy, args, ctx, execArgs } = params;
    if (!op.preview) {
      return errorResponse(
        `Operation "${op.id}" is approval-gated but defines no preview(); ` +
          `cannot compute the exact change to approve.`,
      );
    }

    const what = await op.preview({ args, ctx });
    const requestId = `${this.name}:${op.id}:${contentHash(what)}`;

    const validation = await strategy.validate({
      requestId,
      currentWhat: what,
      providedToken: execArgs.approvalToken,
    });
    if (validation.valid) return null;

    return this.requestApproval({ op, strategy, requestId, what, why: execArgs.why });
  }

  /**
   * Asks for approval and returns the instructions for retrying. The retry line
   * has to name the token for a token strategy and must not for the others, or
   * the caller is told to pass something the strategy will reject.
   */
  private async requestApproval(params: {
    op: Operation<unknown, TCtx>;
    strategy: ApprovalStrategy;
    requestId: string;
    what: string;
    why?: string;
  }): Promise<ToolResponse> {
    const { op, strategy, requestId, what, why } = params;
    const presented = await strategy.present({
      id: requestId,
      operation: `${this.name} ${op.id}`,
      description: op.summary,
      what,
      why: why ?? op.summary,
    });

    const retryHint = strategy.kind === "token" ? `, approvalToken: "<token>"` : ``;
    return {
      content: [
        {
          type: "text",
          text:
            `# Approval required — "${op.id}"\n\n${presented.message}\n\n` +
            `Once approved, re-run \`${this.name}({ operation: "${op.id}", ` +
            `params: {...}${retryHint} })\` with the same params.`,
        },
      ],
    };
  }
}

export interface CreateDescribeExecuteOptions<TCtx> {
  /**
   * Tool prefix; the factory produces `<prefix>_describe` and `<prefix>_execute`.
   * Use snake_case (e.g. "db", "dynamodb").
   */
  prefix: string;
  /** Operation registry holding the ops the tool pair exposes. */
  registry: OperationRegistry<TCtx>;
  /**
   * Builds the per-call shared context. Invoked on every execute call so
   * resources (DB pool, AWS client) are lazy and recover from upstream changes.
   */
  buildContext: (args: Record<string, unknown>) => Promise<TCtx> | TCtx;
  /** Override the describe tool's MCP description. */
  describeDescription?: string;
  /** Override the execute tool's MCP description. */
  executeDescription?: string;
  /** Override the markdown title used when listing operations. Defaults to "<Prefix> Operations". */
  listTitle?: string;
  /** Optional preamble (markdown) shown before the operation listing. */
  preamble?: string;
}

function operationsListTitle<TCtx>(opts: CreateDescribeExecuteOptions<TCtx>): string {
  const titleCase = opts.prefix.charAt(0).toUpperCase() + opts.prefix.slice(1);
  return opts.listTitle ?? `${titleCase} Operations`;
}

/** Defaults so a caller only writes the prose it actually wants to change. */
function toolDescriptions<TCtx>(
  opts: CreateDescribeExecuteOptions<TCtx>,
): { describe: string; execute: string } {
  const { prefix } = opts;
  return {
    describe:
      opts.describeDescription ??
      `List/inspect ${prefix} operations. Call without args for the full listing, or pass operation=<id> for one op's schema.`,
    execute:
      opts.executeDescription ??
      `Execute a ${prefix} operation. Use ${prefix}_describe to discover ops and parameters.`,
  };
}

/**
 * Build a describe/execute MCP tool pair backed by an OperationRegistry.
 *
 * Returns `[describeHandler, executeHandler]` ready to register against a
 * standard ToolRegistry.
 */
export function createDescribeExecuteHandlers<TCtx>(
  opts: CreateDescribeExecuteOptions<TCtx>,
): [BaseToolHandler<{ operation?: string }>, BaseToolHandler<{ operation: string; params?: Record<string, unknown> }>] {
  const describeName = `${opts.prefix}_describe`;
  const executeName = `${opts.prefix}_execute`;
  const descriptions = toolDescriptions(opts);

  const describe = new DescribeHandler(
    opts.registry,
    describeName,
    descriptions.describe,
    executeName,
    operationsListTitle(opts),
    opts.preamble,
  );

  const execute = new ExecuteHandler(
    opts.registry,
    executeName,
    descriptions.execute,
    opts.buildContext,
    describeName,
  );

  return [describe, execute];
}
