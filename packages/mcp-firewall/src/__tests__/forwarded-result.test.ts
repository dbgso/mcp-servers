import { describe, it, expect } from "vitest";
import { dryRunNote, forwardedResult } from "../forwarded-result.js";
import type { TargetResult } from "../forwarded-result.js";

describe("dryRunNote", () => {
  it("says nothing about a call the rules allow", () => {
    expect(dryRunNote({ action: "allow", reason: "ok" })).toEqual([]);
  });

  it.each([
    { action: "deny" as const, outcome: "This call would be blocked" },
    { action: "ask" as const, outcome: "This call would require approval" },
  ])("says what $action would have done, with the reason", ({ action, outcome }) => {
    expect(dryRunNote({ action, reason: "Matched rule: r" })).toEqual([
      { type: "text", text: `[DRY-RUN NOTE] ${outcome}: Matched rule: r\n\n---\n\n` },
    ]);
  });
});

describe("forwardedResult", () => {
  const prefix = [{ type: "text" as const, text: "note" }];

  it("puts the prefix in front of the target's content", () => {
    const result: TargetResult = { content: [{ type: "text", text: "answer" }] };

    expect(forwardedResult({ result, prefix })).toEqual({
      content: [
        { type: "text", text: "note" },
        { type: "text", text: "answer" },
      ],
    });
  });

  it("keeps the target's error flag", () => {
    const result: TargetResult = { content: [{ type: "text", text: "bad" }], isError: true };

    expect(forwardedResult({ result, prefix: [] })).toEqual({
      content: [{ type: "text", text: "bad" }],
      isError: true,
    });
  });

  it("passes an answer without a content list on as JSON, without the prefix", () => {
    const result = { toolResult: 42 } as TargetResult;

    expect(forwardedResult({ result, prefix })).toEqual({
      content: [{ type: "text", text: '{"toolResult":42}' }],
    });
  });
});
