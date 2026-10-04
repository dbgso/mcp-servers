import * as os from "node:os";
import * as path from "node:path";
import { parseArgs } from "node:util";

export interface CliOptions {
  outputDir: string;
}

/**
 * Where reports go unless told otherwise: the OS temp directory, which every
 * machine has and nobody keeps anything important in (`policy__parameterise`).
 */
export function defaultOutputDir(): string {
  return path.join(os.tmpdir(), "report-mcp");
}

/** `--output-dir <dir>`, resolved against the working directory. */
export function parseCli(params: { argv: string[] }): CliOptions {
  const { argv } = params;
  const { values } = parseArgs({
    args: argv,
    options: { "output-dir": { type: "string" } },
    strict: true,
  });
  const given = values["output-dir"];
  return { outputDir: given === undefined ? defaultOutputDir() : path.resolve(given) };
}
