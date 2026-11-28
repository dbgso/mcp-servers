import { parseArgs } from "node:util";
import { getErrorMessage } from "mcp-shared";
import { ChainManager } from "./chain-manager.js";
import { loadConfig } from "./config.js";
import { formatCheck, formatImpact, formatList, formatTrace } from "./cli-format.js";

const USAGE = `Usage: traceable-chain <command> [options]

Commands:
  check                     Run every mechanical check. Exit 1 on errors.
  impact <id|path>          What a change to a document or code path must satisfy and can break
  trace <id> [--up]         Dependency tree below (or above) a document
  list [--type <type>]      List documents
  confirm <id> [--target <parent-id|code>]
                            Record that a document still holds after a change
  bind <id> <path...> [--replace]
                            Bind a document to source code
  link <id> <parent-id>     Add a parent link
  unlink <id> <parent-id>   Remove a parent link
  baseline                  Record baselines for links and code that have none

Options:
  --dir <path>      Document directory (default: ./docs/chain, or the config's)
  --config <file>   Config file (default: chain.config.yaml etc. in the working directory)
  --json            Machine-readable output
  --strict          check: also exit 1 on warnings
  -h, --help        Show this help`;

export interface CliIo {
  out: (text: string) => void;
  err: (text: string) => void;
}

interface CliOptions {
  json: boolean;
  strict: boolean;
  up: boolean;
  replace: boolean;
  type?: string;
  target?: string;
}

interface Command {
  /** Returns the exit code */
  run(params: { manager: ChainManager; args: string[]; options: CliOptions; io: CliIo }): Promise<number>;
}

function requireArgs(params: { args: string[]; count: number; usage: string }): void {
  if (params.args.length < params.count) {
    throw new Error(`Usage: traceable-chain ${params.usage}`);
  }
}

function printJson(params: { io: CliIo; value: unknown }): void {
  params.io.out(JSON.stringify(params.value, null, 2));
}

class CheckCommand implements Command {
  async run({ manager, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    const report = await manager.check();
    if (options.json) printJson({ io, value: report });
    else io.out(formatCheck(report));
    const failed = report.errors > 0 || (options.strict && report.warnings > 0);
    return failed ? 1 : 0;
  }
}

class ImpactCommand implements Command {
  async run({ manager, args, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 1, usage: "impact <id|path>" });
    const subject = args[0];
    const isDocument = (await manager.read(subject)) !== null;
    const report = await manager.impact(isDocument ? { id: subject } : { path: subject });
    if (options.json) printJson({ io, value: report });
    else io.out(formatImpact(report));
    return 0;
  }
}

class TraceCommand implements Command {
  async run({ manager, args, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 1, usage: "trace <id> [--up]" });
    const tree = await manager.trace({ id: args[0], direction: options.up ? "up" : "down" });
    if (!tree) throw new Error(`Document "${args[0]}" not found`);
    if (options.json) printJson({ io, value: tree });
    else io.out(formatTrace(tree));
    return 0;
  }
}

class ListCommand implements Command {
  async run({ manager, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    const docs = await manager.list(options.type);
    if (options.json) printJson({ io, value: docs.map(({ content: _content, ...meta }) => meta) });
    else io.out(formatList(docs));
    return 0;
  }
}

class ConfirmCommand implements Command {
  async run({ manager, args, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 1, usage: "confirm <id> [--target <parent-id|code>]" });
    const result = await manager.confirm({ id: args[0], target: options.target });
    if (options.json) printJson({ io, value: result });
    else io.out(`Confirmed ${result.document.type} "${result.document.title}": ${result.links.length} link(s), ${result.code.length} code path(s)`);
    return 0;
  }
}

class BindCommand implements Command {
  async run({ manager, args, options, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 2, usage: "bind <id> <path...> [--replace]" });
    const doc = await manager.bindCode({ id: args[0], paths: args.slice(1), replace: options.replace });
    if (options.json) printJson({ io, value: doc.code });
    else io.out(`Bound ${doc.type} "${doc.title}" to: ${(doc.code ?? []).map(c => c.path).join(", ")}`);
    return 0;
  }
}

class LinkCommand implements Command {
  async run({ manager, args, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 2, usage: "link <id> <parent-id>" });
    const doc = await manager.link({ id: args[0], parentId: args[1] });
    io.out(`Linked ${doc.type} "${doc.title}" to ${args[1]}`);
    return 0;
  }
}

class UnlinkCommand implements Command {
  async run({ manager, args, io }: Parameters<Command["run"]>[0]): Promise<number> {
    requireArgs({ args, count: 2, usage: "unlink <id> <parent-id>" });
    const doc = await manager.unlink({ id: args[0], parentId: args[1] });
    io.out(`Unlinked ${doc.type} "${doc.title}" from ${args[1]}`);
    return 0;
  }
}

class BaselineCommand implements Command {
  async run({ manager, io }: Parameters<Command["run"]>[0]): Promise<number> {
    const result = await manager.baseline();
    io.out(`Recorded baselines for ${result.links} link(s) and ${result.code} code path(s)`);
    return 0;
  }
}

const COMMANDS: Record<string, Command> = {
  check: new CheckCommand(),
  impact: new ImpactCommand(),
  trace: new TraceCommand(),
  list: new ListCommand(),
  confirm: new ConfirmCommand(),
  bind: new BindCommand(),
  link: new LinkCommand(),
  unlink: new UnlinkCommand(),
  baseline: new BaselineCommand(),
};

/**
 * Run the CLI and return its exit code. Errors are printed, not thrown, so
 * that a hook or CI step gets a message and a non-zero status.
 */
export async function runCli(params: { argv: string[]; io: CliIo; cwd?: string }): Promise<number> {
  const { argv, io, cwd } = params;
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        dir: { type: "string" },
        config: { type: "string" },
        json: { type: "boolean", default: false },
        strict: { type: "boolean", default: false },
        up: { type: "boolean", default: false },
        replace: { type: "boolean", default: false },
        type: { type: "string" },
        target: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    });
    const [name, ...args] = positionals;
    const command = name === undefined ? undefined : COMMANDS[name];
    if (values.help || !command) {
      io.out(USAGE);
      return values.help ? 0 : 2;
    }
    const config = loadConfig({ cwd, basePath: values.dir, configPath: values.config });
    const manager = new ChainManager(config);
    return await command.run({ manager, args, options: values, io });
  } catch (error) {
    io.err(`error: ${getErrorMessage(error)}`);
    return 2;
  }
}
