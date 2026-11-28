#!/usr/bin/env node
/**
 * A server that only exists to be driven by a test.
 *
 * It keeps a counter in process memory, which is the property the sessions are
 * for: if two calls land in the same process the second one sees the first,
 * and if the harness restarts the server between calls it never will.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({ name: "counter-server", version: "1.0.0" });
let count = 0;

server.tool("bump", "Increment the counter and report it", {}, () => {
  count += 1;
  return { content: [{ type: "text" as const, text: `count=${count}` }] };
});

server.tool(
  "echo",
  "Return the arguments as given",
  { text: z.string().optional(), dir: z.string().optional() },
  (args: { text?: string; dir?: string }) => ({
    content: [{ type: "text" as const, text: JSON.stringify(args) }],
  })
);

// Registered without a description, which the protocol allows and the lab has
// to render without printing "undefined".
server.tool("bare", {}, () => ({
  content: [{ type: "text" as const, text: "bare" }],
}));

server.tool("boom", "Always fails", {}, () => ({
  content: [{ type: "text" as const, text: "this tool always fails" }],
  isError: true,
}));

// Something on stderr, so `logs` has a subject -- unless the test wants a
// server that has printed nothing.
const noisy = Number(process.env.NOISY ?? "0");
for (let i = 0; i < noisy; i++) console.error(`noise ${i + 1}`);

if (process.env.QUIET !== "1") {
  console.error(`counter-server up, argv=${process.argv.slice(2).join(" ")}, MARKER=${process.env.MARKER ?? "unset"}`);
}

await server.connect(new StdioServerTransport());
