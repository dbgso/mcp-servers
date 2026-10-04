import { z } from "zod";
import { BaseActionHandler, type ToolResponse } from "mcp-shared";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { errorResponse, textResponse, toolListLines, type LabContext } from "../types.js";
import { expandVars, resolveLaunch } from "../../../launch.js";
import { LabSession, makeScratch, messageOf } from "../../../session.js";

const schema = z.object({
  action: z.literal("start"),
  worktree: z.string().describe("Absolute path to the worktree to run the server from"),
  package: z
    .string()
    .optional()
    .describe("A package under <worktree>/packages, run from src/index.ts through tsx"),
  command: z.string().optional().describe("An explicit command, instead of `package`"),
  args: z
    .array(z.string())
    .optional()
    .describe("Arguments for the server itself. `{{SCRATCH}}` expands to this session's scratch directory"),
  env: z
    .record(z.string())
    .optional()
    .describe("Environment for the server process. Values may use `{{SCRATCH}}`"),
});

type Args = z.infer<typeof schema>;

export class StartHandler extends BaseActionHandler<Args, LabContext> {
  readonly action = "start";
  readonly help = `Start a server and keep it running until \`stop\`.

- \`execute(action: "start", worktree: "/abs/path", package: "interactive-instruction-mcp", args: ["{{SCRATCH}}"])\`
- Starting again gives a new session against the current source; the old one keeps running until you stop it.`;
  readonly schema = schema;

  protected async doExecute(params: { args: Args; context: LabContext }): Promise<ToolResponse> {
    const { worktree, package: pkg, command, args, env } = params.args;
    const { store } = params.context;

    if (!(await isDirectory(worktree))) {
      return errorResponse(`No such worktree: ${worktree}`);
    }

    const tsx = await findTsx({ worktree, pkg });
    if (tsx === null) {
      return errorResponse(
        `tsx not found under ${worktree}. Run \`pnpm install\` there, or pass \`command\` instead of \`package\`.`
      );
    }

    const resolved = resolveLaunch({ worktree, package: pkg, command, args, tsx });
    if (!resolved.ok) return errorResponse(resolved.error);

    const id = store.nextId();
    const scratch = await makeScratch(id);
    const vars = { SCRATCH: scratch, WORKTREE: worktree };

    const session = new LabSession({
      id,
      spec: expandVars({ value: resolved.spec, vars }),
      scratch,
      env: expandVars({ value: env ?? {}, vars }),
    });

    try {
      await session.start();
    } catch (error) {
      await session.stop({ keepScratch: false });
      return errorResponse(`Session failed to start.\n\n${messageOf(error)}`);
    }

    store.add(session);

    const tools = await session.listTools();
    const lines = [
      `Session **${id}** started.`,
      "",
      `- **command**: \`${session.spec.command} ${session.spec.args.join(" ")}\``,
      `- **cwd**: ${session.spec.cwd}`,
      `- **scratch**: ${scratch}`,
      ...(Object.keys(session.env).length === 0
        ? []
        : [`- **env**: ${Object.entries(session.env).map(([k, v]) => `${k}=${v}`).join(", ")}`]),
      "",
      "## Tools",
      ...toolListLines(tools),
      "",
      `Call one with \`execute(action: "call", session: "${id}", tool: "<name>", params: { ... })\`.`,
    ];

    return textResponse(lines.join("\n"));
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  return fs
    .stat(dir)
    .then((stat) => stat.isDirectory())
    .catch(() => false);
}

/**
 * Where pnpm put tsx.
 *
 * It may be linked into the package, the workspace root, or both, depending on
 * which of them declares it -- looking in one place only is how a spawn comes
 * to fail on a clean install while working on the machine it was written on.
 */
async function findTsx(params: { worktree: string; pkg?: string }): Promise<string | null> {
  const { worktree, pkg } = params;
  const candidates = [
    ...(pkg === undefined ? [] : [path.join(worktree, "packages", pkg, "node_modules", ".bin", "tsx")]),
    path.join(worktree, "node_modules", ".bin", "tsx"),
  ];

  for (const candidate of candidates) {
    const found = await fs.access(candidate).then(() => true, () => false);
    if (found) return candidate;
  }
  return null;
}
