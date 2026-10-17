/**
 * The command line: `claim-chain-mcp [root]` serves MCP, and
 * `claim-chain-mcp check [root]` runs the check once and exits 1 on any error.
 *
 * The check is a command as well as an action so that the same judgement can
 * stop a commit or a CI run, where no MCP client is there to call it.
 */

import * as path from "node:path";
import { ClaimChain } from "./chain.js";
import { formatFindings, hasErrors } from "./checks.js";

/** Where claims live when no root is given. */
export const DEFAULT_ROOT = "docs/claims";

export type Invocation = { command: "serve"; root: string } | { command: "check"; root: string };

export function parseArgs(params: { argv: string[]; cwd: string }): Invocation {
  const [first, second] = params.argv;
  if (first === "check") {
    return { command: "check", root: path.resolve(params.cwd, second ?? DEFAULT_ROOT) };
  }
  return { command: "serve", root: path.resolve(params.cwd, first ?? DEFAULT_ROOT) };
}

/** Run the check, print what it found, and say what the exit code should be. */
export async function runCheck(params: { root: string; print: (text: string) => void }): Promise<number> {
  const findings = await new ClaimChain(params.root).check();
  params.print(formatFindings(findings));
  return hasErrors(findings) ? 1 : 0;
}
