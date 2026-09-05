import { z } from "zod";
import { evaluateExpectation, type HttpExpectation } from "./evaluate/http-expect.js";
import type { PollOutcome, WatchSource } from "./types.js";

const expectationSchema = z.object({
  status: z.union([z.number().int(), z.array(z.number().int())]).optional().describe("Expected status code(s)"),
  body_matches: z.string().optional().describe("Regex the response body must match"),
  json_path: z.string().optional().describe("Path into the JSON body, e.g. status.phase or items[0].id"),
  json_equals: z.unknown().optional().describe("Value json_path must equal"),
  json_matches: z.string().optional().describe("Regex the json_path value must match"),
});

const configSchema = z.object({
  url: z.string().describe("URL to poll"),
  method: z.string().optional().describe("HTTP method (default: GET)"),
  headers: z.record(z.string()).optional().describe("Extra request headers"),
  body: z.string().optional().describe("Request body"),
  expect: expectationSchema.describe("Conditions that must all hold"),
});

type Config = z.infer<typeof configSchema>;

export const httpSource: WatchSource<Config> = {
  id: "http",
  summary: "Wait until an HTTP endpoint reports the expected state",
  detail: `Polls a URL and stops once every condition in \`expect\` holds.

A body that is not valid JSON simply fails the json_* conditions instead of failing the poll, so a
temporary 502 during a deploy does not kill the watch.

Examples:
  params: { config: { url: "https://example.com/healthz", expect: { status: 200 } } }
  params: { config: { url: "https://api.example.com/jobs/7", expect: { json_path: "status", json_equals: "done" } } }`,
  category: "Generic",
  defaultIntervalMs: 30_000,
  minIntervalMs: 5_000,
  configSchema,
  async poll({ config, deps }): Promise<PollOutcome> {
    const response = await deps.httpRequest({
      url: config.url,
      method: config.method,
      headers: config.headers,
      body: config.body,
    });
    const result = evaluateExpectation({ response, expectation: config.expect as HttpExpectation });

    return {
      satisfied: result.satisfied,
      summary: result.satisfied
        ? `expectation met (status ${response.status})`
        : `status ${response.status}; unmet: ${result.unmet.join("; ")}`,
      details: { status: response.status, unmet: result.unmet, body: response.body.slice(0, 500) },
      events: result.satisfied ? [`expectation met (status ${response.status})`] : [],
    };
  },
};
