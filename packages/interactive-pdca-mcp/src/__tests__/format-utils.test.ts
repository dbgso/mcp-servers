import { describe, it, expect } from "vitest";
import { formatParallel } from "../tools/plan/handlers/format-utils.js";
import type { TaskSummary } from "../types/index.js";

describe("format-utils", () => {
  describe("formatParallel", () => {
    const baseTask: TaskSummary = {
      id: "test-task",
      title: "Test Task",
      status: "pending",
      parent: "",
      dependencies: [],
      is_parallelizable: false,
    };

    describe("style: info", () => {
      it("returns 'no' when task is not parallelizable", () => {
        const result = formatParallel({
          task: { ...baseTask, is_parallelizable: false },
          options: { style: "info" },
        });
        expect(result).toBe("no");
      });

      it("returns 'yes' when task is parallelizable without units", () => {
        const result = formatParallel({
          task: { ...baseTask, is_parallelizable: true },
          options: { style: "info" },
        });
        expect(result).toBe("yes");
      });

      it("returns 'yes (units: ...)' when task has parallelizable units", () => {
        const result = formatParallel({
          task: {
            ...baseTask,
            is_parallelizable: true,
            parallelizable_units: ["task-a", "task-b"],
          },
          options: { style: "info" },
        });
        expect(result).toBe("yes (units: task-a, task-b)");
      });

      it("returns 'yes' when parallelizable_units is empty array", () => {
        const result = formatParallel({
          task: {
            ...baseTask,
            is_parallelizable: true,
            parallelizable_units: [],
          },
          options: { style: "info" },
        });
        expect(result).toBe("yes");
      });
    });

    describe("style: tag", () => {
      it("returns empty string when task is not parallelizable", () => {
        const result = formatParallel({
          task: { ...baseTask, is_parallelizable: false },
          options: { style: "tag" },
        });
        expect(result).toBe("");
      });

      it("returns ' [parallel]' when task is parallelizable without units", () => {
        const result = formatParallel({
          task: { ...baseTask, is_parallelizable: true },
          options: { style: "tag" },
        });
        expect(result).toBe(" [parallel]");
      });

      it("returns ' [parallel: ...]' when task has parallelizable units", () => {
        const result = formatParallel({
          task: {
            ...baseTask,
            is_parallelizable: true,
            parallelizable_units: ["unit-1", "unit-2"],
          },
          options: { style: "tag" },
        });
        expect(result).toBe(" [parallel: unit-1, unit-2]");
      });

      it("returns ' [parallel]' when parallelizable_units is empty array", () => {
        const result = formatParallel({
          task: {
            ...baseTask,
            is_parallelizable: true,
            parallelizable_units: [],
          },
          options: { style: "tag" },
        });
        expect(result).toBe(" [parallel]");
      });
    });
  });
});
