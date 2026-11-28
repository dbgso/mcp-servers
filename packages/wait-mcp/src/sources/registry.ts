import { fileSource } from "./file.js";
import { githubChecksSource } from "./github-checks.js";
import { githubIssueSource } from "./github-issue.js";
import { httpSource } from "./http.js";
import { slackSource } from "./slack.js";
import type { WatchSource } from "./types.js";

/** Every source the server can watch. All of them are read-only observers. */
export const allSources: WatchSource[] = [
  githubChecksSource as WatchSource,
  githubIssueSource as WatchSource,
  slackSource as WatchSource,
  httpSource as WatchSource,
  fileSource as WatchSource,
];

const sourceMap = new Map<string, WatchSource>(allSources.map((source) => [source.id, source]));

export function getSource(id: string): WatchSource | undefined {
  return sourceMap.get(id);
}

export function getSourcesByCategory(): Record<string, WatchSource[]> {
  const grouped: Record<string, WatchSource[]> = {};
  for (const source of allSources) {
    if (!grouped[source.category]) grouped[source.category] = [];
    grouped[source.category].push(source);
  }
  return grouped;
}
