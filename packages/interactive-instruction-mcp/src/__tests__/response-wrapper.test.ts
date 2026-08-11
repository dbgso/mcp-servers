import { describe, it, expect } from "vitest";
import { buildReminderBlock, wrapResponse } from "../utils/response-wrapper.js";
import type { ReminderConfig } from "../types/index.js";

describe("buildReminderBlock", () => {
  it.each<{
    name: string;
    config: ReminderConfig;
    expected: string[] | null;
  }>([
    {
      name: "returns null when no reminders configured",
      config: { remindMcp: false, remindOrganize: false, customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: null,
    },
    {
      name: "includes MCP reminder only",
      config: { remindMcp: true, remindOrganize: false, customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["Always refer to this MCP", "help"],
    },
    {
      name: "includes organize reminder only",
      config: { remindMcp: false, remindOrganize: true, customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["Review document organization", "ONE topic only"],
    },
    {
      name: "includes both built-in reminders",
      config: { remindMcp: true, remindOrganize: true, customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["Always refer to this MCP", "Review document organization"],
    },
    {
      name: "includes single custom reminder with prefix",
      config: { remindMcp: false, remindOrganize: false, customReminders: ["Run tests"], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["[Reminder] Run tests"],
    },
    {
      name: "includes multiple custom reminders",
      config: { remindMcp: false, remindOrganize: false, customReminders: ["First", "Second"], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["[Reminder] First", "[Reminder] Second"],
    },
    {
      name: "combines all reminder types",
      config: { remindMcp: true, remindOrganize: true, customReminders: ["Custom"], topicForEveryTask: null, infoValidSeconds: 60 },
      expected: ["Always refer to this MCP", "Review document organization", "[Reminder] Custom"],
    },
    {
      name: "includes topic-for-every-task reminder with custom seconds",
      config: { remindMcp: false, remindOrganize: false, customReminders: [], topicForEveryTask: "always-check", infoValidSeconds: 30 },
      expected: ["30 seconds", "always-check", "help(id:"],
    },
  ])("$name", ({ config, expected }) => {
    const result = buildReminderBlock({ config });

    if (expected === null) {
      expect(result).toBeNull();
    } else {
      expect(result).not.toBeNull();
      for (const text of expected) {
        expect(result).toContain(text);
      }
    }
  });

  it("starts with separator when reminders exist", () => {
    const result = buildReminderBlock({
      config: { remindMcp: true, remindOrganize: false, customReminders: [], topicForEveryTask: null, infoValidSeconds: 60 },
    });

    expect(result).toMatch(/^\n\n---\n\n/);
  });
});

describe("wrapResponse", () => {
  it("should return original result when no reminders configured", () => {
    const originalResult = {
      content: [{ type: "text" as const, text: "Original content" }],
    };
    const config: ReminderConfig = {
      remindMcp: false,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    };

    const result = wrapResponse({ result: originalResult, config });

    expect(result).toEqual(originalResult);
    expect(result.content[0].text).toBe("Original content");
  });

  it("should append reminder block when reminders configured", () => {
    const originalResult = {
      content: [{ type: "text" as const, text: "Original content" }],
    };
    const config: ReminderConfig = {
      remindMcp: true,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    };

    const result = wrapResponse({ result: originalResult, config });

    expect(result.content[0].text).toContain("Original content");
    expect(result.content[0].text).toContain("---");
    expect(result.content[0].text).toContain("Always refer to this MCP");
  });

  it("should wrap multiple content items", () => {
    const originalResult = {
      content: [
        { type: "text" as const, text: "First" },
        { type: "text" as const, text: "Second" },
      ],
    };
    const config: ReminderConfig = {
      remindMcp: true,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    };

    const result = wrapResponse({ result: originalResult, config });

    expect(result.content).toHaveLength(2);
    expect(result.content[0].text).toContain("First");
    expect(result.content[0].text).toContain("Always refer to this MCP");
    expect(result.content[1].text).toContain("Second");
    expect(result.content[1].text).toContain("Always refer to this MCP");
  });

  it("should preserve isError flag", () => {
    const originalResult = {
      content: [{ type: "text" as const, text: "Error message" }],
      isError: true,
    };
    const config: ReminderConfig = {
      remindMcp: true,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    };

    const result = wrapResponse({ result: originalResult, config });

    expect(result.isError).toBe(true);
  });

  it("should preserve additional properties on result", () => {
    const originalResult = {
      content: [{ type: "text" as const, text: "Content" }],
      customProperty: "value",
    };
    const config: ReminderConfig = {
      remindMcp: false,
      remindOrganize: false,
      customReminders: [],
      topicForEveryTask: null,
      infoValidSeconds: 60,
    };

    const result = wrapResponse({ result: originalResult, config });

    expect(result.customProperty).toBe("value");
  });
});
