/**
 * One running server, kept alive between calls.
 *
 * Staying alive is the feature. An MCP server's state lives in its process --
 * a deliberation gate counting identical attempts, a draft waiting to be
 * approved, an update staged for `apply` -- so a harness that starts a server,
 * makes one call and exits can never reach any of it. A session here lasts
 * from `start` to `stop`, and every call in between lands in the same process.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { LaunchSpec } from "./launch.js";
import { VERSION } from "./version.js";

/** How many lines of the server's stderr to keep. */
const LOG_LINES = 200;

export interface SessionInfo {
  id: string;
  spec: LaunchSpec;
  scratch: string;
  startedAt: string;
  env: Record<string, string>;
}

export class LabSession {
  readonly id: string;
  readonly spec: LaunchSpec;
  readonly scratch: string;
  readonly startedAt = new Date().toISOString();
  readonly env: Record<string, string>;

  private readonly client: Client;
  private readonly transport: StdioClientTransport;
  private readonly log: string[] = [];
  private stopped = false;

  constructor(params: { id: string; spec: LaunchSpec; scratch: string; env: Record<string, string> }) {
    this.id = params.id;
    this.spec = params.spec;
    this.scratch = params.scratch;
    this.env = params.env;

    this.transport = new StdioClientTransport({
      command: params.spec.command,
      args: params.spec.args,
      cwd: params.spec.cwd,
      env: { ...inheritedEnv(), ...params.env },
      stderr: "pipe",
    });

    this.client = new Client({ name: "mcp-lab", version: VERSION }, { capabilities: {} });
  }

  /**
   * Connect, and keep whatever the server printed on the way.
   *
   * A server that refuses to start says why on stderr and then exits, and the
   * client sees only "Connection closed" -- which names nothing. The listener
   * is attached as early as it can be, and read again on failure, because that
   * text is usually the entire answer.
   */
  async start(): Promise<void> {
    const connecting = this.client.connect(this.transport);
    this.captureStderr();

    try {
      await connecting;
    } catch (error) {
      this.captureStderr();
      // Give the pipe a turn to deliver what the child wrote before exiting.
      await new Promise((resolve) => setTimeout(resolve, 50));
      throw new Error(`${messageOf(error)}${this.log.length === 0 ? "" : `\n\n${this.logs()}`}`);
    }

    this.captureStderr();
  }

  async listTools(): Promise<Tool[]> {
    const { tools } = await this.client.listTools();
    return tools;
  }

  async call(params: { tool: string; args: Record<string, unknown> }): Promise<{ text: string; isError: boolean }> {
    const result = await this.client.callTool({ name: params.tool, arguments: params.args });
    const content = result.content as { type: string; text?: string }[] | undefined;
    return {
      text: (content ?? []).map((part) => part.text ?? "").join("\n"),
      isError: result.isError === true,
    };
  }

  logs(): string {
    return this.log.join("\n");
  }

  info(): SessionInfo {
    return { id: this.id, spec: this.spec, scratch: this.scratch, startedAt: this.startedAt, env: this.env };
  }

  /** Close the client, kill the child, and take the scratch directory with it. */
  async stop(params: { keepScratch: boolean }): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    await this.client.close().catch(() => {});
    if (!params.keepScratch) {
      await fs.rm(this.scratch, { recursive: true, force: true }).catch(() => {});
    }
  }

  private captureStderr(): void {
    const stream = this.transport.stderr;
    if (stream === undefined || stream === null) return;
    // `once` would drop everything after the first chunk, and attaching twice
    // would double every line.
    if (stream.listenerCount("data") > 0) return;

    stream.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim() === "") continue;
        this.log.push(line);
        if (this.log.length > LOG_LINES) this.log.shift();
      }
    });
  }
}

/** `process.env` with the holes removed, since the SDK wants defined values. */
function inheritedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A directory for this session to write into, and to lose on `stop`. */
export async function makeScratch(id: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `mcp-lab-${id}-`));
}
