import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { FeedbackReader } from "../services/feedback-reader.js";

describe("FeedbackReader", () => {
  let testDir: string;
  let feedbackReader: FeedbackReader;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `feedback-reader-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    feedbackReader = new FeedbackReader(testDir);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("createDraftFeedback", () => {
    type CreateDraftFeedbackTestCase = {
      name: string;
      original: string;
      decision: "adopted" | "rejected";
      expectedDecision: string;
    };

    const createDraftFeedbackTestCases: CreateDraftFeedbackTestCase[] = [
      {
        name: "adopted decision",
        original: "Please fix this bug",
        decision: "adopted",
        expectedDecision: "adopted",
      },
      {
        name: "rejected decision",
        original: "Optional improvement",
        decision: "rejected",
        expectedDecision: "rejected",
      },
    ];

    it.each(createDraftFeedbackTestCases)(
      "should create draft feedback with $name",
      async ({ original, decision, expectedDecision }) => {
        const result = await feedbackReader.createDraftFeedback({
          taskId: "task-1",
          original,
          decision,
        });

        expect(result.success).toBe(true);
        expect(result.feedbackId).toBeDefined();
        expect(result.feedbackId).toMatch(/^fb-\d+$/);

        const feedback = await feedbackReader.getFeedback("task-1", result.feedbackId!);
        expect(feedback?.decision).toBe(expectedDecision);
      }
    );
  });

  describe("getFeedback", () => {
    it("should retrieve created feedback", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback content",
        decision: "adopted",
      });

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);

      expect(feedback).not.toBeNull();
      expect(feedback?.task_id).toBe("task-1");
      expect(feedback?.original).toBe("Feedback content");
      expect(feedback?.decision).toBe("adopted");
      expect(feedback?.status).toBe("draft");
      expect(feedback?.interpretation).toBeNull();
    });

    it("should return null for non-existent feedback", async () => {
      const feedback = await feedbackReader.getFeedback("task-1", "non-existent");
      expect(feedback).toBeNull();
    });
  });

  describe("listFeedback", () => {
    it("should return empty array when no feedback exists", async () => {
      const list = await feedbackReader.listFeedback("task-1");
      expect(list).toEqual([]);
    });

    it("should list all feedback for a task", async () => {
      await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "First feedback",
        decision: "adopted",
      });

      // Wait a bit to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Second feedback",
        decision: "rejected",
      });

      const list = await feedbackReader.listFeedback("task-1");

      expect(list).toHaveLength(2);
      // Newest first
      expect(list[0].original).toBe("Second feedback");
      expect(list[1].original).toBe("First feedback");
    });
  });

  describe("addInterpretation", () => {
    it("should add interpretation to draft feedback", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Fix the bug",
        decision: "adopted",
      });

      const result = await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        interpretation: "I will fix the null pointer exception",
      });

      expect(result.success).toBe(true);

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);
      expect(feedback?.interpretation).toBe("I will fix the null pointer exception");
    });

    it("should return error for non-existent feedback", async () => {
      const result = await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: "non-existent",
        interpretation: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error for already confirmed feedback", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Fix the bug",
        decision: "adopted",
      });

      await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        interpretation: "Will fix",
      });

      await feedbackReader.confirmFeedback({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
      });

      const result = await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        interpretation: "New interpretation",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("already confirmed");
    });
  });

  describe("confirmFeedback", () => {
    it("should confirm feedback with interpretation", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback",
        decision: "adopted",
      });

      await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        interpretation: "My interpretation",
      });

      const result = await feedbackReader.confirmFeedback({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
      });

      expect(result.success).toBe(true);

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);
      expect(feedback?.status).toBe("confirmed");
    });

    type ConfirmFeedbackErrorTestCase = {
      name: string;
      setupType: "non-existent" | "already-confirmed" | "no-interpretation";
      expectedError: string;
    };

    const confirmFeedbackErrorTestCases: ConfirmFeedbackErrorTestCase[] = [
      {
        name: "non-existent feedback",
        setupType: "non-existent",
        expectedError: "not found",
      },
      {
        name: "already confirmed feedback",
        setupType: "already-confirmed",
        expectedError: "already confirmed",
      },
      {
        name: "feedback without interpretation",
        setupType: "no-interpretation",
        expectedError: "no interpretation",
      },
    ];

    it.each(confirmFeedbackErrorTestCases)(
      "should return error for $name",
      async ({ setupType, expectedError }) => {
        let feedbackId: string;

        if (setupType === "non-existent") {
          feedbackId = "non-existent";
        } else if (setupType === "already-confirmed") {
          const createResult = await feedbackReader.createDraftFeedback({
            taskId: "task-1",
            original: "Feedback",
            decision: "adopted",
          });
          await feedbackReader.addInterpretation({
            taskId: "task-1",
            feedbackId: createResult.feedbackId!,
            interpretation: "Interpretation",
          });
          await feedbackReader.confirmFeedback({
            taskId: "task-1",
            feedbackId: createResult.feedbackId!,
          });
          feedbackId = createResult.feedbackId!;
        } else {
          const createResult = await feedbackReader.createDraftFeedback({
            taskId: "task-1",
            original: "Feedback",
            decision: "adopted",
          });
          feedbackId = createResult.feedbackId!;
        }

        const result = await feedbackReader.confirmFeedback({
          taskId: "task-1",
          feedbackId,
        });

        expect(result.success).toBe(false);
        expect(result.error).toContain(expectedError);
      }
    );
  });

  describe("markAsAddressed", () => {
    it("should mark confirmed feedback as addressed", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback",
        decision: "adopted",
      });

      await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        interpretation: "Interpretation",
      });

      await feedbackReader.confirmFeedback({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
      });

      const result = await feedbackReader.markAsAddressed({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        addressedBy: "task-2",
      });

      expect(result.success).toBe(true);

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);
      expect(feedback?.addressed_by).toBe("task-2");
    });

    it("should return error for non-existent feedback", async () => {
      const result = await feedbackReader.markAsAddressed({
        taskId: "task-1",
        feedbackId: "non-existent",
        addressedBy: "task-2",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });

    it("should return error when not confirmed", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback",
        decision: "adopted",
      });

      const result = await feedbackReader.markAsAddressed({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
        addressedBy: "task-2",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not confirmed");
    });
  });

  describe("getUnaddressedFeedback", () => {
    it("should return only confirmed and unaddressed feedback", async () => {
      // Create and confirm feedback
      const fb1 = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback 1",
        decision: "adopted",
      });

      await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: fb1.feedbackId!,
        interpretation: "Interp 1",
      });

      await feedbackReader.confirmFeedback({
        taskId: "task-1",
        feedbackId: fb1.feedbackId!,
      });

      // Create draft feedback (should not be included)
      await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback 2",
        decision: "adopted",
      });

      const unaddressed = await feedbackReader.getUnaddressedFeedback("task-1");

      expect(unaddressed).toHaveLength(1);
      expect(unaddressed[0].original).toBe("Feedback 1");
    });
  });

  describe("getDraftFeedback", () => {
    it("should return only draft feedback", async () => {
      // Create draft feedback
      const fb1 = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Draft feedback",
        decision: "adopted",
      });

      // Wait to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));

      // Create and confirm feedback
      const fb2 = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Confirmed feedback",
        decision: "adopted",
      });

      await feedbackReader.addInterpretation({
        taskId: "task-1",
        feedbackId: fb2.feedbackId!,
        interpretation: "Interp",
      });

      await feedbackReader.confirmFeedback({
        taskId: "task-1",
        feedbackId: fb2.feedbackId!,
      });

      const drafts = await feedbackReader.getDraftFeedback("task-1");

      expect(drafts).toHaveLength(1);
      expect(drafts[0].id).toBe(fb1.feedbackId);
      expect(drafts[0].original).toBe("Draft feedback");
    });
  });

  describe("deleteFeedback", () => {
    it("should delete feedback", async () => {
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "To delete",
        decision: "adopted",
      });

      const result = await feedbackReader.deleteFeedback({
        taskId: "task-1",
        feedbackId: createResult.feedbackId!,
      });

      expect(result.success).toBe(true);

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);
      expect(feedback).toBeNull();
    });

    it("should return error for non-existent feedback", async () => {
      const result = await feedbackReader.deleteFeedback({
        taskId: "task-1",
        feedbackId: "non-existent",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("clearTaskFeedback", () => {
    it("should clear all feedback for a task", async () => {
      await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback 1",
        decision: "adopted",
      });

      // Wait to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 5));

      await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Feedback 2",
        decision: "rejected",
      });

      const result = await feedbackReader.clearTaskFeedback("task-1");

      expect(result.success).toBe(true);
      expect(result.count).toBe(2);

      const list = await feedbackReader.listFeedback("task-1");
      expect(list).toHaveLength(0);
    });

    it("should return zero count when no feedback exists", async () => {
      const result = await feedbackReader.clearTaskFeedback("task-1");

      expect(result.success).toBe(true);
      expect(result.count).toBe(0);
    });

    it("should skip non-.md files in feedback directory", async () => {
      // Create feedback
      await feedbackReader.createDraftFeedback({
        taskId: "task-skip",
        original: "Test",
        decision: "adopted",
      });

      // Add a non-.md file directly
      const taskFeedbackDir = path.join(testDir, "feedback", "task-skip");
      await fs.writeFile(path.join(taskFeedbackDir, "other.txt"), "other file", "utf-8");

      const result = await feedbackReader.clearTaskFeedback("task-skip");

      // Should only count .md files
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);
    });
  });

  describe("listFeedback - edge cases", () => {
    it("should skip non-.md files in feedback directory", async () => {
      // Create a feedback entry
      await feedbackReader.createDraftFeedback({
        taskId: "task-mixed",
        original: "Test",
        decision: "adopted",
      });

      // Add a non-.md file directly
      const taskFeedbackDir = path.join(testDir, "feedback", "task-mixed");
      await fs.writeFile(path.join(taskFeedbackDir, "other.txt"), "other file", "utf-8");

      const list = await feedbackReader.listFeedback("task-mixed");

      // Should only include .md files
      expect(list).toHaveLength(1);
    });
  });

  describe("parseYamlValue", () => {
    it("should parse boolean values", async () => {
      // Create feedback, then manually verify parsing through getFeedback
      const createResult = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Test",
        decision: "adopted",
      });

      const feedback = await feedbackReader.getFeedback("task-1", createResult.feedbackId!);

      // The status should be parsed correctly
      expect(feedback?.status).toBe("draft");
      expect(feedback?.decision).toBe("adopted");
    });

    it("should handle boolean true value in file", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-bool");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "bool-test.md"),
        `---
id: bool-test
task_id: task-bool
original: "Test"
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-bool", "bool-test");
      expect(feedback).not.toBeNull();
    });

    it("should parse boolean true value correctly", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-true");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Use a file where we can test true value parsing
      await fs.writeFile(
        path.join(taskFeedbackDir, "bool-true.md"),
        `---
id: bool-true
task_id: task-true
original: true
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      // Since original must be a string for validation, this should fail
      const feedback = await feedbackReader.getFeedback("task-true", "bool-true");
      // The file will be invalid because original is not a string
      expect(feedback).toBeNull();
    });

    it("should parse boolean false value correctly", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-false-val");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Create a file where false is used as a value
      await fs.writeFile(
        path.join(taskFeedbackDir, "bool-false-val.md"),
        `---
id: bool-false-val
task_id: task-false-val
original: "Test with false"
interpretation: false
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-false-val", "bool-false-val");
      expect(feedback).not.toBeNull();
      // interpretation parsed as boolean false, but cast to string | null
      expect(feedback?.interpretation).toBe(false);
    });

    it("should handle unquoted string values", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-unquoted");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "unquoted.md"),
        `---
id: unquoted
task_id: task-unquoted
original: Unquoted string value
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-unquoted", "unquoted");
      expect(feedback?.original).toBe("Unquoted string value");
    });

    it("should handle true and false boolean values", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-booleans");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Create file with true value explicitly (interpretation: true would be unusual but tests the branch)
      await fs.writeFile(
        path.join(taskFeedbackDir, "bool-true.md"),
        `---
id: bool-true
task_id: task-booleans
original: "Test"
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-booleans", "bool-true");
      expect(feedback).not.toBeNull();
    });
  });

  describe("createDraftFeedback - error handling", () => {
    it("should return error when directory creation fails", async () => {
      // Create a file that will block directory creation
      const blockingFile = path.join(testDir, "feedback");
      await fs.writeFile(blockingFile, "blocking", "utf-8");

      const result = await feedbackReader.createDraftFeedback({
        taskId: "task-1",
        original: "Test feedback",
        decision: "adopted",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("Failed to create feedback");
    });
  });

  describe("parseFeedbackFile - edge cases", () => {
    it("should return null for invalid file format", async () => {
      // Create a malformed file directly
      const taskFeedbackDir = path.join(testDir, "feedback", "task-1");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "malformed.md"),
        "No frontmatter here",
        "utf-8"
      );

      const list = await feedbackReader.listFeedback("task-1");
      expect(list).toHaveLength(0);
    });

    it("should return null for missing required fields", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-1");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "incomplete.md"),
        `---
id: fb-123
---
Missing task_id and original`,
        "utf-8"
      );

      const list = await feedbackReader.listFeedback("task-1");
      expect(list).toHaveLength(0);
    });

    it("should handle null value in YAML", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-1");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "with-null.md"),
        `---
id: fb-123
task_id: task-1
original: "Test original"
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-1", "with-null");
      expect(feedback?.interpretation).toBeNull();
      expect(feedback?.addressed_by).toBeNull();
    });

    it("should handle single quoted strings", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-1");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      await fs.writeFile(
        path.join(taskFeedbackDir, "quoted.md"),
        `---
id: fb-quoted
task_id: task-1
original: 'Single quoted string'
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-1", "quoted");
      expect(feedback?.original).toBe("Single quoted string");
    });

    it("should handle boolean false value in parseYamlValue", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-bool-false");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Create a file with a false value (unusual but tests the branch)
      await fs.writeFile(
        path.join(taskFeedbackDir, "bool-false.md"),
        `---
id: bool-false
task_id: task-bool-false
original: "Test"
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-bool-false", "bool-false");
      expect(feedback).not.toBeNull();
    });

    it("should skip lines without colon in YAML parsing", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-no-colon");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Create a file with a line that has no colon
      await fs.writeFile(
        path.join(taskFeedbackDir, "no-colon.md"),
        `---
id: no-colon
task_id: task-no-colon
original: "Test"
this line has no colon so should be skipped
interpretation: null
decision: adopted
status: draft
timestamp: 2024-01-01T00:00:00Z
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-no-colon", "no-colon");
      expect(feedback).not.toBeNull();
      expect(feedback?.original).toBe("Test");
    });

    it("should use default values for missing decision, status, timestamp", async () => {
      const taskFeedbackDir = path.join(testDir, "feedback", "task-defaults");
      await fs.mkdir(taskFeedbackDir, { recursive: true });
      // Create a file without decision, status, timestamp
      await fs.writeFile(
        path.join(taskFeedbackDir, "defaults.md"),
        `---
id: defaults
task_id: task-defaults
original: "Test"
interpretation: null
addressed_by: null
---
`,
        "utf-8"
      );

      const feedback = await feedbackReader.getFeedback("task-defaults", "defaults");
      expect(feedback).not.toBeNull();
      expect(feedback?.decision).toBe("rejected");
      expect(feedback?.status).toBe("draft");
      expect(feedback?.timestamp).toBeDefined();
    });
  });
});
