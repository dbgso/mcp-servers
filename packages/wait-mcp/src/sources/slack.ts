import { z } from "zod";
import { tryParseJson } from "./evaluate/json-path.js";
import { describeMessage, latestTs, selectNewMessages, type SlackMessage } from "./evaluate/slack.js";
import type { PollOutcome, WatchSource } from "./types.js";

const DEFAULT_TOKEN_ENV = "SLACK_BOT_TOKEN";

const configSchema = z.object({
  channel: z.string().describe("Channel ID (e.g. C0123456789)"),
  thread_ts: z.string().optional().describe("Thread timestamp; omit to watch the channel itself"),
  match: z.string().optional().describe("Regex the message text must match"),
  from: z.string().optional().describe("Only accept messages from this user ID"),
  token_env: z.string().optional().describe(`Env var holding the bot token (default: ${DEFAULT_TOKEN_ENV})`),
});

type Config = z.infer<typeof configSchema>;

interface SlackState extends Record<string, unknown> {
  baselineTs: string;
}

/** Slack endpoint for the watched conversation. */
export function buildSlackUrl(config: { channel: string; thread_ts?: string }): string {
  if (config.thread_ts === undefined) {
    return `https://slack.com/api/conversations.history?channel=${encodeURIComponent(config.channel)}&limit=50`;
  }
  return `https://slack.com/api/conversations.replies?channel=${encodeURIComponent(config.channel)}&ts=${encodeURIComponent(config.thread_ts)}&limit=50`;
}

/** Read the message list out of a Slack API payload, failing on API-level errors. */
export function parseSlackPayload(body: string): SlackMessage[] {
  const payload = tryParseJson(body) as { ok?: boolean; error?: string; messages?: unknown[] } | undefined;
  if (payload === undefined) {
    throw new Error("Slack API returned non-JSON output");
  }
  if (payload.ok !== true) {
    throw new Error(`Slack API error: ${payload.error ?? "unknown"}`);
  }
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  return messages.map((message) => {
    const record = message as { ts?: unknown; user?: unknown; text?: unknown };
    return {
      ts: String(record.ts ?? "0"),
      user: record.user === undefined ? undefined : String(record.user),
      text: record.text === undefined ? undefined : String(record.text),
    };
  });
}

export const slackSource: WatchSource<Config> = {
  id: "slack",
  summary: "Wait for a Slack reply in a thread or channel",
  detail: `Polls conversations.replies (with thread_ts) or conversations.history (without) using a bot token
read from an environment variable.

The newest message at the first poll becomes the baseline, so only messages posted after the watch
started can satisfy it. \`match\` and \`from\` narrow which of those count.

Required Slack scopes: channels:history (and groups:history / im:history for private conversations).

Examples:
  params: { config: { channel: "C0123456789", thread_ts: "1712345678.000100" } }
  params: { config: { channel: "C0123456789", match: "(approved|LGTM)" } }`,
  category: "Chat",
  defaultIntervalMs: 15_000,
  minIntervalMs: 5_000,
  configSchema,
  async poll({ config, state, deps }): Promise<PollOutcome> {
    const tokenEnv = config.token_env ?? DEFAULT_TOKEN_ENV;
    const token = deps.env(tokenEnv);
    if (!token) {
      throw new Error(`Slack token not found in environment variable ${tokenEnv}`);
    }

    const response = await deps.httpRequest({
      url: buildSlackUrl(config),
      headers: { Authorization: `Bearer ${token}` },
    });
    const messages = parseSlackPayload(response.body);

    const previous = (state as SlackState | undefined)?.baselineTs;
    const baselineTs = previous ?? latestTs(messages) ?? "0";
    const fresh = selectNewMessages({
      messages,
      baselineTs: previous,
      match: config.match,
      from: config.from,
    });

    return {
      satisfied: fresh.length > 0,
      summary:
        fresh.length > 0
          ? `${fresh.length} new message(s)`
          : `no new message yet (baseline ${baselineTs})`,
      state: { baselineTs },
      details: { channel: config.channel, messages: fresh },
      events: fresh.map(describeMessage),
    };
  },
};
