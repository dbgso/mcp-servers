import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import type {
  CommandResult,
  CommandSpec,
  FileStat,
  HttpRequest,
  HttpResponse,
  SourceDeps,
} from "../sources/types.js";

const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function runCommand(spec: CommandSpec): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve) => {
    execFile(
      spec.command,
      spec.args,
      { cwd: spec.cwd, maxBuffer: MAX_OUTPUT_BYTES },
      (error, stdout, stderr) => {
        const exitCode = (error as { code?: number } | null)?.code ?? 0;
        resolve({ stdout, stderr, exitCode: typeof exitCode === "number" ? exitCode : 1 });
      },
    );
  });
}

async function httpRequest(request: HttpRequest): Promise<HttpResponse> {
  const response = await fetch(request.url, {
    method: request.method ?? "GET",
    headers: request.headers,
    body: request.body,
  });
  return { status: response.status, body: await response.text() };
}

async function statFile(path: string): Promise<FileStat | null> {
  try {
    const info = await stat(path);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

/** Real I/O implementation used by the running server. */
export const defaultDeps: SourceDeps = {
  runCommand,
  httpRequest,
  readFileText: (path: string) => readFile(path, "utf8"),
  statFile,
  env: (name: string) => process.env[name],
  now: () => Date.now(),
};
