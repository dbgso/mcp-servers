import { describe, it, expect } from "vitest";
import { wrapResponse, buildReminderBlock } from "../utils/response-wrapper.js";
import type { ReminderConfig, ToolResult } from "../types/index.js";

describe("response-wrapper", () => {
  const baseConfig: ReminderConfig = {
    remindMcp: false,
    remindOrganize: false,
    customReminders: [],
    topicForEveryTask: null,
    infoValidSeconds: 60,
  };

  describe("buildReminderBlock", () => {
    it("returns null when no reminders are configured", () => {
      const result = buildReminderBlock({ config: baseConfig });
      expect(result).toBeNull();
    });

    it("includes MCP reminder when remindMcp is true", () => {
      const config = { ...baseConfig, remindMcp: true };
      const result = buildReminderBlock({ config });
      expect(result).toContain("[Reminder]");
      expect(result).toContain("help");
    });

    it("includes organize reminder when remindOrganize is true", () => {
      const config = { ...baseConfig, remindOrganize: true };
      const result = buildReminderBlock({ config });
      expect(result).toContain("[Reminder]");
      expect(result).toContain("organization");
    });

    it("includes custom reminders", () => {
      const config = { ...baseConfig, customReminders: ["Custom message 1", "Custom message 2"] };
      const result = buildReminderBlock({ config });
      expect(result).toContain("Custom message 1");
      expect(result).toContain("Custom message 2");
    });

    it("includes topic reminder when topicForEveryTask is set", () => {
      const config = { ...baseConfig, topicForEveryTask: "every-task", infoValidSeconds: 120 };
      const result = buildReminderBlock({ config });
      expect(result).toContain("every-task");
      expect(result).toContain("120 seconds");
    });
  });

  describe("wrapResponse", () => {
    it("returns original result when no reminders are configured", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "Original text" }],
      };
      const wrapped = wrapResponse({ result, config: baseConfig });
      expect(wrapped).toEqual(result);
    });

    it("appends reminder block to all content items", () => {
      const result: ToolResult = {
        content: [
          { type: "text", text: "First item" },
          { type: "text", text: "Second item" },
        ],
      };
      const config = { ...baseConfig, remindMcp: true };
      const wrapped = wrapResponse({ result, config });

      expect(wrapped.content[0].text).toContain("First item");
      expect(wrapped.content[0].text).toContain("[Reminder]");
      expect(wrapped.content[1].text).toContain("Second item");
      expect(wrapped.content[1].text).toContain("[Reminder]");
    });

    it("preserves isError flag", () => {
      const result: ToolResult = {
        content: [{ type: "text", text: "Error" }],
        isError: true,
      };
      const config = { ...baseConfig, remindMcp: true };
      const wrapped = wrapResponse({ result, config });
      expect(wrapped.isError).toBe(true);
    });
  });
});
