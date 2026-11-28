/**
 * The reminder block appended to every tool response.
 *
 * It is the one piece of this server's output that is not about a task: a
 * standing instruction the operator configured, carried on each answer. None
 * of it was tested, and the combination that matters is the empty one --
 * reminders all off, which is the default -- where the response has to come
 * back untouched rather than with a trailing separator.
 */

import { describe, it, expect } from "vitest";
import { buildReminderBlock, wrapResponse } from "../utils/response-wrapper.js";
import type { ReminderConfig } from "../types/index.js";

const off: ReminderConfig = {
  remindMcp: false,
  remindOrganize: false,
  customReminders: [],
  topicForEveryTask: null,
  infoValidSeconds: 60,
};

const textResult = { content: [{ type: "text" as const, text: "the answer" }] };

describe("the reminder block", () => {
  it("is absent when every reminder is off", () => {
    expect(buildReminderBlock({ config: off })).toBeNull();
  });

  it.each([
    { name: "the MCP reminder", config: { ...off, remindMcp: true }, expected: "help" },
    {
      name: "the organisation reminder",
      config: { ...off, remindOrganize: true },
      expected: "ONE topic",
    },
    {
      name: "a custom reminder",
      config: { ...off, customReminders: ["read the runbook"] },
      expected: "read the runbook",
    },
    {
      name: "the every-task topic",
      config: { ...off, topicForEveryTask: "house-rules" },
      expected: "house-rules",
    },
  ])("carries $name on its own", ({ config, expected }) => {
    const block = buildReminderBlock({ config });

    expect(block).toContain(expected);
    expect(block?.startsWith("\n\n---\n\n")).toBe(true);
  });

  it("puts the every-task topic first, ahead of the standing ones", () => {
    // It is the only reminder with an expiry, so it is the one a caller has
    // to act on rather than merely read.
    const block = buildReminderBlock({
      config: {
        remindMcp: true,
        remindOrganize: true,
        customReminders: ["and this"],
        topicForEveryTask: "house-rules",
        infoValidSeconds: 30,
      },
    });

    const lines = (block ?? "").split("\n\n").filter((l) => l.startsWith("[Reminder]"));
    expect(lines[0]).toContain("house-rules");
    expect(lines[0]).toContain("30 seconds");
    expect(lines).toHaveLength(4);
  });
});

describe("wrapping a response", () => {
  it("returns it unchanged when there is nothing to remind anyone of", () => {
    // Identity, not a copy with an empty block: a trailing separator on every
    // answer is noise the caller then has to strip.
    expect(wrapResponse({ result: textResult, config: off })).toBe(textResult);
  });

  it("appends the block to text content", () => {
    const wrapped = wrapResponse({
      result: textResult,
      config: { ...off, remindMcp: true },
    });

    const first = wrapped.content[0];
    expect(first.type).toBe("text");
    expect(first.type === "text" && first.text.startsWith("the answer")).toBe(true);
    expect(JSON.stringify(wrapped.content)).toContain("[Reminder]");
  });

  it("leaves content that is not text alone", () => {
    // An image or a resource has no place to append prose to, and mangling it
    // would corrupt the payload rather than add a note.
    const result = {
      content: [
        { type: "image" as const, data: "AAAA", mimeType: "image/png" },
        { type: "text" as const, text: "and a caption" },
      ],
    };

    const wrapped = wrapResponse({ result, config: { ...off, remindMcp: true } });

    expect(wrapped.content[0]).toEqual({ type: "image", data: "AAAA", mimeType: "image/png" });
    const second = wrapped.content[1];
    expect(second.type === "text" && second.text).toContain("[Reminder]");
  });

  it("keeps the rest of the response, error flag included", () => {
    const wrapped = wrapResponse({
      result: { ...textResult, isError: true },
      config: { ...off, remindMcp: true },
    });

    expect(wrapped.isError).toBe(true);
  });
});
