import { tryParseJson } from "./evaluate/json-path.js";
import type { SourceDeps } from "./types.js";

/**
 * Repository slug for `gh api` paths. Without an explicit repo the literal
 * placeholders are kept so gh resolves the repository of the working directory.
 */
export function repoSlug(repo: string | undefined): string {
  if (repo === undefined) {
    return "{owner}/{repo}";
  }
  return repo;
}

/** Run gh and return its raw stdout, turning a non-zero exit into an error. */
export async function runGh(params: {
  deps: SourceDeps;
  args: string[];
  cwd: string | undefined;
}): Promise<string> {
  const result = await params.deps.runCommand({ command: "gh", args: params.args, cwd: params.cwd });
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    throw new Error(`gh ${params.args.join(" ")} failed (exit ${result.exitCode}): ${detail}`);
  }
  return result.stdout;
}

/** Run gh and parse its stdout as JSON. */
export async function runGhJson(params: {
  deps: SourceDeps;
  args: string[];
  cwd: string | undefined;
}): Promise<unknown> {
  const stdout = await runGh(params);
  const parsed = tryParseJson(stdout);
  if (parsed === undefined) {
    throw new Error(`gh ${params.args.join(" ")} returned non-JSON output`);
  }
  return parsed;
}
