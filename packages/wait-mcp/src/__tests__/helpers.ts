import type {
  CommandResult,
  CommandSpec,
  FileStat,
  HttpRequest,
  HttpResponse,
  SourceDeps,
} from "../sources/types.js";

export interface FakeFile {
  content?: string;
  stat: FileStat;
}

export interface FakeDepsOptions {
  runCommand?: (spec: CommandSpec) => CommandResult | Promise<CommandResult>;
  httpRequest?: (request: HttpRequest) => HttpResponse | Promise<HttpResponse>;
  files?: Record<string, FakeFile>;
  env?: Record<string, string>;
  now?: () => number;
}

/** SourceDeps whose I/O is fully scripted by the test. */
export function createFakeDeps(options: FakeDepsOptions = {}): SourceDeps {
  const files = options.files ?? {};
  return {
    runCommand: async (spec) => {
      if (!options.runCommand) {
        throw new Error(`unexpected command: ${spec.command} ${spec.args.join(" ")}`);
      }
      return options.runCommand(spec);
    },
    httpRequest: async (request) => {
      if (!options.httpRequest) {
        throw new Error(`unexpected request: ${request.url}`);
      }
      return options.httpRequest(request);
    },
    readFileText: async (path) => {
      const file = files[path];
      if (file?.content === undefined) {
        throw new Error(`no such file: ${path}`);
      }
      return file.content;
    },
    statFile: async (path) => files[path]?.stat ?? null,
    env: (name) => options.env?.[name],
    now: options.now ?? (() => 0),
  };
}

/** Command runner that answers by matching the joined argv against patterns. */
export function scriptedCommands(
  routes: { match: RegExp; stdout?: string; stderr?: string; exitCode?: number }[],
): (spec: CommandSpec) => CommandResult {
  return (spec) => {
    const line = [spec.command, ...spec.args].join(" ");
    const route = routes.find((entry) => entry.match.test(line));
    if (!route) {
      throw new Error(`unexpected command: ${line}`);
    }
    return { stdout: route.stdout ?? "", stderr: route.stderr ?? "", exitCode: route.exitCode ?? 0 };
  };
}

/** Responder returning each element in turn, repeating the last one. */
export function sequence<T>(values: T[]): () => T {
  let index = 0;
  return () => {
    const value = values[Math.min(index, values.length - 1)];
    index += 1;
    return value;
  };
}

/** Let every already-scheduled promise callback run. */
export function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

/** Text payload of a tool response. */
export function textOf(result: { content: { type: string }[] }): string {
  return (result.content[0] as unknown as { text: string }).text;
}

/** JSON payload of a tool response. */
export function jsonOf<T = Record<string, unknown>>(result: { content: { type: string }[] }): T {
  return JSON.parse(textOf(result)) as T;
}
