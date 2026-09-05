import { z } from "zod";
import type { FileStat, PollOutcome, SourceDeps, WatchSource } from "./types.js";

const configSchema = z.object({
  path: z.string().describe("File path to watch"),
  until: z
    .enum(["exists", "missing", "changed", "matches"])
    .optional()
    .describe("Condition to wait for (default: exists)"),
  pattern: z.string().optional().describe("Regex the content must match; required when until=matches"),
});

type Config = z.infer<typeof configSchema>;
type FileUntil = NonNullable<Config["until"]>;

interface FileState extends Record<string, unknown> {
  baseline: FileStat | null;
}

interface FileInput {
  stat: FileStat | null;
  baseline: FileStat | null;
  config: Config;
  deps: SourceDeps;
}

interface FileEvaluation {
  satisfied: boolean;
  summary: string;
}

async function evaluateExists(input: FileInput): Promise<FileEvaluation> {
  return {
    satisfied: input.stat !== null,
    summary: input.stat === null ? "file does not exist yet" : `file exists (${input.stat.size} bytes)`,
  };
}

async function evaluateMissing(input: FileInput): Promise<FileEvaluation> {
  return {
    satisfied: input.stat === null,
    summary: input.stat === null ? "file is gone" : "file still exists",
  };
}

async function evaluateChanged(input: FileInput): Promise<FileEvaluation> {
  const changed =
    input.stat?.mtimeMs !== input.baseline?.mtimeMs || input.stat?.size !== input.baseline?.size;
  return {
    satisfied: changed,
    summary: changed ? "file changed" : "file unchanged",
  };
}

async function evaluateMatches(input: FileInput): Promise<FileEvaluation> {
  // A missing file cannot match, but it is not an error either
  if (input.stat === null) {
    return { satisfied: false, summary: "file does not exist yet" };
  }
  const pattern = input.config.pattern ?? "";
  const content = await input.deps.readFileText(input.config.path);
  const matched = new RegExp(pattern).test(content);
  return {
    satisfied: matched,
    summary: matched ? `content matches /${pattern}/` : `content does not match /${pattern}/`,
  };
}

const CONDITIONS: Record<FileUntil, (input: FileInput) => Promise<FileEvaluation>> = {
  exists: evaluateExists,
  missing: evaluateMissing,
  changed: evaluateChanged,
  matches: evaluateMatches,
};

export const fileSource: WatchSource<Config> = {
  id: "file",
  summary: "Wait for a local file to appear, disappear, change or match",
  detail: `Polls the file system with stat/read only.

\`changed\` compares against the mtime and size recorded at the first poll, so it never fires on the
poll that established the baseline. The other conditions are absolute and can fire immediately.

Examples:
  params: { config: { path: "./tmp/report.json", until: "exists" } }
  params: { config: { path: "./build.log", until: "matches", pattern: "BUILD (SUCCESS|FAILED)" } }`,
  category: "Generic",
  defaultIntervalMs: 5_000,
  minIntervalMs: 1_000,
  configSchema,
  async poll({ config, state, deps }): Promise<PollOutcome> {
    const until: FileUntil = config.until ?? "exists";
    // Matching without a pattern would accept any content
    if (until === "matches" && config.pattern === undefined) {
      throw new Error('config.pattern is required when until="matches"');
    }

    const stat = await deps.statFile(config.path);
    const previous = state as FileState | undefined;
    const baseline = previous === undefined ? stat : previous.baseline;
    const evaluation = await CONDITIONS[until]({ stat, baseline, config, deps });

    return {
      satisfied: evaluation.satisfied,
      summary: `${config.path}: ${evaluation.summary}`,
      state: { baseline },
      details: { path: config.path, stat },
      events: evaluation.satisfied ? [evaluation.summary] : [],
    };
  },
};
