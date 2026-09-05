import type { z } from "zod";

/** Per-watch state a source carries across polls (baselines, resolved refs, ...). */
export type SourceState = Record<string, unknown> | undefined;

/** Result of evaluating a source once. */
export interface PollOutcome {
  /** True when there is no longer a reason to keep waiting. */
  satisfied: boolean;
  /** One-line, human readable state of the watched thing. */
  summary: string;
  /** State handed back to the next poll. Omit to keep the previous state. */
  state?: SourceState;
  /** Structured detail of the observation. */
  details?: unknown;
  /** Notable things observed during this poll. */
  events?: string[];
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

export interface FileStat {
  mtimeMs: number;
  size: number;
}

export interface CommandSpec {
  command: string;
  args: string[];
  cwd?: string;
}

/** All I/O a source is allowed to perform, injected so sources stay testable. */
export interface SourceDeps {
  runCommand(spec: CommandSpec): Promise<CommandResult>;
  httpRequest(request: HttpRequest): Promise<HttpResponse>;
  readFileText(path: string): Promise<string>;
  statFile(path: string): Promise<FileStat | null>;
  env(name: string): string | undefined;
  now(): number;
}

export interface WatchSource<TConfig = unknown> {
  id: string;
  summary: string;
  detail: string;
  category: string;
  defaultIntervalMs: number;
  minIntervalMs: number;
  configSchema: z.ZodType<TConfig>;
  // Method syntax for bivariance (allows assignment to WatchSource<unknown>[])
  poll(params: { config: TConfig; state: SourceState; deps: SourceDeps }): Promise<PollOutcome>;
}
