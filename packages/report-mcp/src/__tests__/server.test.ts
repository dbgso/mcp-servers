/**
 * The server over a real MCP connection: what it advertises, how `exec`
 * routes `op`, and what reaches the disk.
 */
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { validateReport } from "mcp-shared-report";
import { createServer } from "../server.js";
import { EXAMPLE_REPORT } from "../describe.js";
import { ReportOp } from "../ops/report.js";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "report-mcp-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const FIXED_NOW = new Date("2026-10-04T08:45:00.000Z");

async function connected(): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer({ outputDir: dir, now: () => FIXED_NOW });
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function textOf(result: Awaited<ReturnType<Client["callTool"]>>): string {
  const [first] = result.content as { type: string; text: string }[];
  return first.text;
}

describe("the advertised tools", () => {
  it("are describe and exec, and exec lists the report's required fields", async () => {
    const client = await connected();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["describe", "exec"]);
    const exec = tools.find((t) => t.name === "exec");
    expect(exec?.inputSchema.required).toEqual([
      "op",
      "title",
      "conclusion",
      "background",
      "impact",
      "claims",
      "asks",
      "decisions",
    ]);
    const impact = exec?.inputSchema.properties?.impact as {
      properties: { scope: { items: { required: string[] } } };
    };
    expect(impact.properties.scope.items.required).toEqual(["who", "what", "when", "where", "why", "how"]);
    const { asks, remaining } = (exec?.inputSchema.properties ?? {}) as {
      asks: { items: { anyOf: { required: string[] }[] } };
      remaining: { items: { required: string[] } };
    };
    expect(asks.items.anyOf[1].required).toEqual(["kind", "who", "what", "when", "where", "why", "how"]);
    expect(remaining.items.required).toEqual(["who", "what", "when", "where", "why", "how"]);
    await client.close();
  });

  it("leaves validation to the handler, so a call missing fields gets every problem with its criterion", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "exec", arguments: { op: "report", title: "t" } });
    expect(textOf(result)).toContain("- impact: required (R10)");
    await client.close();
  });
});

describe("describe", () => {
  it("shows the call, the criteria and an example", async () => {
    const client = await connected();
    const text = textOf(await client.callTool({ name: "describe", arguments: {} }));
    expect(text).toContain('exec(op: "report"');
    expect(text).toContain("| R3 | A claim carries its raw evidence |");
    expect(text).toContain('"op": "report"');
    await client.close();
  });

  it("gives an example the validator accepts", () => {
    expect(validateReport({ input: EXAMPLE_REPORT }).ok).toBe(true);
  });
});

describe("exec(op: report)", () => {
  it("writes the example as an HTML page and returns its path", async () => {
    const client = await connected();
    const result = await client.callTool({ name: "exec", arguments: { op: "report", ...EXAMPLE_REPORT } });
    const expected = path.join(dir, "2026-10-04T08-45-00-docs-is-not-shipped-in-the-package.html");
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toBe(`Report written: ${expected}`);
    const html = await readFile(expected, "utf-8");
    expect(html).toContain("<h1>docs/ is not shipped in the package</h1>");
    await client.close();
  });

  it("accepts list fields sent as JSON strings, as a client without a schema sends them", async () => {
    const client = await connected();
    const args = {
      op: "report",
      title: "t",
      conclusion: "c",
      background: "b",
      impact: JSON.stringify(EXAMPLE_REPORT.impact),
      claims: JSON.stringify(EXAMPLE_REPORT.claims),
      asks: "[]",
      decisions: JSON.stringify(EXAMPLE_REPORT.decisions),
    };
    const result = await client.callTool({ name: "exec", arguments: args });
    expect(result.isError).toBeFalsy();
    await client.close();
  });

  it("says when a list field's JSON text does not parse", async () => {
    const client = await connected();
    const args = { op: "report", title: "t", conclusion: "c", background: "b", impact: '{"ifLeft"', claims: '[{"statement": "s"', asks: "[]", decisions: "[]" };
    const result = await client.callTool({ name: "exec", arguments: args });
    expect(textOf(result)).toContain("- impact: an object, or its JSON text; this text is not valid JSON (R10)\n");
    expect(textOf(result)).toContain("- claims: a list, or its JSON text; this text is not valid JSON (R2)\n");
    await client.close();
  });

  it("rejects a field the structure does not have", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "exec",
      arguments: { op: "report", ...EXAMPLE_REPORT, summary: "s" },
    });
    expect(textOf(result)).toContain("- summary: not a field of the report; it would not reach the page\n");
    expect(await readdir(dir)).toEqual([]);
    await client.close();
  });

  it("writes nothing when a required field is missing, and lists every problem", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "exec",
      arguments: { op: "report", title: "t", claims: [{ statement: "s", evidence: [] }] },
    });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      [
        "The report was not written. 6 problems:",
        "- conclusion: required (R1)",
        "- background: required (R7)",
        "- impact: required (R10)",
        "- claims[0].evidence: at least one evidence is required (R3)",
        "- asks: required; pass [] if nothing is needed from the reader (R4)",
        "- decisions: required; pass [] if you decided nothing on your own (R8)",
        "",
        "Call `describe` for the structure and what each field is for.",
      ].join("\n"),
    );
    expect(await readdir(dir)).toEqual([]);
    await client.close();
  });

  it("says 'problem' for one", async () => {
    const client = await connected();
    const result = await client.callTool({
      name: "exec",
      arguments: { op: "report", ...EXAMPLE_REPORT, title: undefined },
    });
    expect(textOf(result)).toMatch(/^The report was not written\. 1 problem:\n- title: required\n/);
    await client.close();
  });

  it("never overwrites an earlier report", async () => {
    const client = await connected();
    const call = () => client.callTool({ name: "exec", arguments: { op: "report", ...EXAMPLE_REPORT } });
    await call();
    const second = await call();
    expect(textOf(second)).toMatch(/-docs-is-not-shipped-in-the-package-2\.html$/);
    expect((await readdir(dir)).length).toBe(2);
    await client.close();
  });
});

describe("exec without a known op", () => {
  it.each([
    [{}, "No `op` was given"],
    [{ op: "send" }, 'Unknown op: "send"'],
  ])("refuses %j and lists the ops", async (args, lead) => {
    const client = await connected();
    const result = await client.callTool({ name: "exec", arguments: args });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(`${lead}. \`op\` is one of "report". Call \`describe\` for what each takes.`);
    await client.close();
  });
});

describe("the clock", () => {
  it("is the real one unless a test supplies another", async () => {
    const before = Date.now();
    const result = await new ReportOp(dir).execute({ op: "report", ...EXAMPLE_REPORT });
    const [name] = await readdir(dir);
    const stamp = name.slice(0, 19).replace(/T(\d{2})-(\d{2})-(\d{2})$/, "T$1:$2:$3");
    expect(result.isError).toBeUndefined();
    expect(Date.parse(`${stamp}Z`)).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
  });
});
