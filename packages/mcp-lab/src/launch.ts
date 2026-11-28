/**
 * Turning "the iimcp in that worktree, with this env" into a command line.
 *
 * Separated from the spawning so it can be tested without starting anything:
 * the mistakes this code can make -- resolving to the wrong worktree, dropping
 * a server argument, leaving a `{{SCRATCH}}` unexpanded so a server writes to
 * a directory literally named that -- are all decisions, and none of them need
 * a child process to observe.
 */

export interface LaunchSpec {
  command: string;
  args: string[];
  cwd: string;
}

export interface LaunchRequest {
  /** Absolute path to the worktree the server should be run from. */
  worktree: string;
  /** A package under `<worktree>/packages`, run from source through tsx. */
  package?: string;
  /** An explicit command, for a server this repository does not contain. */
  command?: string;
  /** Arguments for the server itself. */
  args?: string[];
  /** Where tsx was found, for the `package` form. */
  tsx: string;
}

export type LaunchResult =
  | { ok: true; spec: LaunchSpec }
  | { ok: false; error: string };

/**
 * `{{NAME}}` anywhere in a string, an array or an object.
 *
 * `{{SCRATCH}}` is the one that matters: a flow has to be able to name the
 * directory this session is using without knowing it in advance, or every
 * session would write into the same place and read the last one's leftovers.
 * An unknown name is left alone rather than replaced with `undefined`, because
 * a silent `undefined` in a path is how a server ends up writing to
 * `/undefined/docs` and reporting success.
 */
export function expandVars<T>(params: { value: T; vars: Record<string, string> }): T {
  const { value, vars } = params;

  if (typeof value === "string") {
    return value.replace(/\{\{(\w+)\}\}/g, (whole, name: string) =>
      Object.hasOwn(vars, name) ? vars[name] : whole
    ) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => expandVars({ value: item, vars })) as T;
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, expandVars({ value: item, vars })])
    ) as T;
  }

  return value;
}

/**
 * The command line for a session.
 *
 * `package` runs `<worktree>/packages/<name>/src/index.ts` through tsx --
 * source, not `dist`. That is the whole point of this server: a built bundle
 * goes stale the moment someone edits a source file, so a harness pointed at
 * `dist` would quietly answer for last week's code, which is worse than not
 * answering at all.
 */
export function resolveLaunch(request: LaunchRequest): LaunchResult {
  const { worktree, package: pkg, command, args = [], tsx } = request;

  if (pkg === undefined && command === undefined) {
    return { ok: false, error: "Pass `package` (a package in the worktree) or `command` (anything else)." };
  }

  if (pkg !== undefined && command !== undefined) {
    return { ok: false, error: "Pass `package` or `command`, not both." };
  }

  if (command !== undefined) {
    return { ok: true, spec: { command, args, cwd: worktree } };
  }

  // Not `path.join`: this runs on the server's own platform, and a package
  // name is a single segment by construction.
  const entry = `${worktree}/packages/${pkg}/src/index.ts`;
  return { ok: true, spec: { command: tsx, args: [entry, ...args], cwd: worktree } };
}
