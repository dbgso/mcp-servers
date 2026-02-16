import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { PlanReader } from "../services/plan-reader.js";
import { PlanReporter } from "../services/plan-reporter.js";

describe("PlanReporter", () => {
  let testDir: string;
  let planReader: PlanReader;
  let planReporter: PlanReporter;

  beforeEach(async () => {
    testDir = path.join(os.tmpdir(), `plan-reporter-test-${Date.now()}`);
    await fs.mkdir(testDir, { recursive: true });
    planReader = new PlanReader(testDir);
    planReporter = new PlanReporter(testDir, planReader);
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("updatePendingReviewFile", () => {
    it("should create PENDING_REVIEW.md with no tasks message when empty", async () => {
      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("# Pending Review Tasks");
      expect(content).toContain("No tasks pending review");
    });

    it("should include pending_review tasks in the file", async () => {
      await planReader.addTask({
        id: "test-task",
        title: "Test Task",
        content: "Test content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Tests pass",
        deliverables: ["code.ts", "test.ts"],
        is_parallelizable: false,
        references: [],
      });

      // Change to pending_review with task_output
      await planReader.updateStatus({
        id: "test-task",
        status: "pending_review",
        task_output: {
          what: "テストを追加した",
          why: "完了条件を満たす",
          how: "手動でテストを作成",
          blockers: [],
          risks: [],
          phase: "implement",
          changes: [
            { file: "src/test.ts", lines: "1-10", description: "テスト追加" },
          ],
          design_decisions: "シンプルな設計",
          references_used: [],
          references_reason: "参照不要",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("test-task");
      expect(content).toContain("Test Task");
      expect(content).toContain("src/test.ts");
      expect(content).toContain("1-10");
      expect(content).toContain("Tests pass");
      expect(content).toContain("完了条件を満たす");
    });

    it("should not include completed tasks", async () => {
      await planReader.addTask({
        id: "completed-task",
        title: "Completed Task",
        content: "Done",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["file.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "completed-task",
        status: "completed",
        output: "src/completed.ts:1-10 完了.",
      });

      // Approve to make it completed
      await planReader.approveTask("completed-task");

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).not.toContain("completed-task");
    });
  });

  describe("updateGraphFile", () => {
    it("should create GRAPH.md with mermaid diagram", async () => {
      await planReader.addTask({
        id: "task-a",
        title: "Task A",
        content: "First task",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["a.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("# Task Graph");
      expect(content).toContain("```mermaid");
      expect(content).toContain("flowchart LR");
      expect(content).toContain("task_a");
      expect(content).toContain("Task A");
    });

    it("should show dependencies as arrows", async () => {
      await planReader.addTask({
        id: "task-a",
        title: "Task A",
        content: "First",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["a.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.addTask({
        id: "task-b",
        title: "Task B",
        content: "Depends on A",
        parent: "",
        dependencies: ["task-a"],
        dependency_reason: "Needs A first",
        prerequisites: "A done",
        completion_criteria: "Done",
        deliverables: ["b.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("task_a --> task_b");
    });

    it("should show status icons", async () => {
      await planReader.addTask({
        id: "pending-task",
        title: "Pending",
        content: "Not started",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["p.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.addTask({
        id: "done-task",
        title: "Done",
        content: "Finished",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["d.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "done-task",
        status: "completed",
        output: "src/done.ts:1-10 完了.",
      });
      await planReader.approveTask("done-task");

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("○"); // pending
      expect(content).toContain("✓"); // completed
    });
  });

  describe("updateAll", () => {
    it("should update both files", async () => {
      await planReader.addTask({
        id: "test-task",
        title: "Test",
        content: "Content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Done",
        deliverables: ["test.ts"],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateAll();

      const pendingReview = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      const graph = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );

      expect(pendingReview).toContain("# Pending Review Tasks");
      expect(graph).toContain("# Task Graph");
    });
  });

  describe("formatPhaseSection - research phase", () => {
    it("should format research phase with findings and sources", async () => {
      await planReader.addTask({
        id: "research-task",
        title: "Research Task",
        content: "Research content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Research complete",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "research-task",
        status: "pending_review",
        task_output: {
          what: "Researched the topic",
          why: "Sufficient findings",
          how: "Manual research",
          blockers: [],
          risks: [],
          phase: "research",
          findings: "Found important information",
          sources: ["https://example.com", "docs/reference.md"],
          references_used: ["doc-1"],
          references_reason: "Used for context",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("Findings");
      expect(content).toContain("Found important information");
      expect(content).toContain("Sources");
      expect(content).toContain("https://example.com");
      expect(content).toContain("docs/reference.md");
    });

    it("should format research phase with empty findings and sources", async () => {
      await planReader.addTask({
        id: "empty-research",
        title: "Empty Research",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "empty-research",
        status: "pending_review",
        task_output: {
          what: "Did research",
          why: "Complete",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "research",
          references_used: [],
          references_reason: "No references needed",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("(なし)");
    });
  });

  describe("formatPhaseSection - verify phase", () => {
    it("should format verify phase with test results", async () => {
      await planReader.addTask({
        id: "verify-task",
        title: "Verify Task",
        content: "Verify content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Tests pass",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "verify-task",
        status: "pending_review",
        task_output: {
          what: "Verified the implementation",
          why: "All tests pass",
          how: "Ran test suite",
          blockers: [],
          risks: [],
          phase: "verify",
          test_target: "src/services/*.ts",
          test_results: "All 50 tests passed",
          coverage: "95% coverage achieved",
          references_used: [],
          references_reason: "No references",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("Test Target");
      expect(content).toContain("src/services/*.ts");
      expect(content).toContain("Test Results");
      expect(content).toContain("All 50 tests passed");
      expect(content).toContain("Coverage");
      expect(content).toContain("95% coverage achieved");
    });
  });

  describe("formatPhaseSection - fix phase", () => {
    it("should format fix phase with feedback addressed", async () => {
      await planReader.addTask({
        id: "fix-task",
        title: "Fix Task",
        content: "Fix content",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "None",
        completion_criteria: "Feedback addressed",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "fix-task",
        status: "pending_review",
        task_output: {
          what: "Fixed the issues",
          why: "All feedback addressed",
          how: "Manual fixes",
          blockers: [],
          risks: [],
          phase: "fix",
          changes: [
            { file: "src/fix.ts", lines: "10-20", description: "Fixed bug" },
          ],
          feedback_addressed: "Addressed code review comments",
          references_used: [],
          references_reason: "No refs",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("Feedback Addressed");
      expect(content).toContain("Addressed code review comments");
      expect(content).toContain("src/fix.ts");
    });
  });

  describe("formatBlockersRisks", () => {
    it("should format blockers and risks when present", async () => {
      await planReader.addTask({
        id: "risky-task",
        title: "Risky Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "risky-task",
        status: "pending_review",
        task_output: {
          what: "Did work",
          why: "Complete",
          how: "Manual",
          blockers: ["API rate limit hit", "Missing credentials"],
          risks: ["Performance degradation", "Security concern"],
          phase: "implement",
          changes: [],
          design_decisions: "Simple design",
          references_used: [],
          references_reason: "None",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("API rate limit hit");
      expect(content).toContain("Missing credentials");
      expect(content).toContain("Performance degradation");
      expect(content).toContain("Security concern");
    });
  });

  describe("getStatusIcon and getStatusStyle", () => {
    type StatusIconStyleTestCase = {
      status: string;
      icon: string;
      style: string;
    };

    const statusIconStyleTestCases: StatusIconStyleTestCase[] = [
      { status: "blocked", icon: "◇", style: "fill:#FFB6C1" },
      { status: "skipped", icon: "⊘", style: "fill:#D3D3D3" },
      { status: "in_progress", icon: "●", style: "fill:#87CEEB" },
      { status: "pending_review", icon: "⏳", style: "fill:#DDA0DD" },
    ];

    it.each(statusIconStyleTestCases)(
      "should show $status status icon and style",
      async ({ status, icon, style }) => {
        // Setup based on status type
        if (status === "blocked") {
          await planReader.addTask({
            id: "dep-task",
            title: "Dependency",
            content: "",
            parent: "",
            dependencies: [],
            dependency_reason: "",
            prerequisites: "",
            completion_criteria: "",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          });
          const blockedTaskContent = `---
id: blocked-task
title: "Blocked Task"
status: blocked
parent: ""
dependencies: ["dep-task"]
dependency_reason: "Needs dep"
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "null"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Task content`;
          await fs.writeFile(
            path.join(testDir, "blocked-task.md"),
            blockedTaskContent,
            "utf-8"
          );
          planReader.invalidateCache();
        } else if (status === "skipped") {
          const skippedTaskContent = `---
id: skipped-task
title: "Skipped Task"
status: skipped
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "null"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Task content`;
          await fs.writeFile(
            path.join(testDir, "skipped-task.md"),
            skippedTaskContent,
            "utf-8"
          );
          planReader.invalidateCache();
        } else if (status === "in_progress") {
          await planReader.addTask({
            id: "progress-task",
            title: "In Progress",
            content: "",
            parent: "",
            dependencies: [],
            dependency_reason: "",
            prerequisites: "",
            completion_criteria: "",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          });
          await planReader.updateStatus({
            id: "progress-task",
            status: "in_progress",
          });
        } else if (status === "pending_review") {
          await planReader.addTask({
            id: "review-task",
            title: "Review Task",
            content: "",
            parent: "",
            dependencies: [],
            dependency_reason: "",
            prerequisites: "",
            completion_criteria: "",
            deliverables: [],
            is_parallelizable: false,
            references: [],
          });
          await planReader.updateStatus({
            id: "review-task",
            status: "pending_review",
            task_output: {
              what: "Done",
              why: "Complete",
              how: "Manual",
              blockers: [],
              risks: [],
              phase: "implement",
              changes: [],
              design_decisions: "",
              references_used: [],
              references_reason: "",
            },
          });
        }

        await planReporter.updateGraphFile();

        const content = await fs.readFile(
          path.join(testDir, "GRAPH.md"),
          "utf-8"
        );
        expect(content).toContain(icon);
        expect(content).toContain(style);
      }
    );
  });

  describe("formatTaskReport - no output", () => {
    it("should format task with no output recorded", async () => {
      await planReader.addTask({
        id: "no-output-task",
        title: "No Output Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // Set to pending_review without task_output
      const taskContent = `---
id: no-output-task
title: "No Output Task"
status: pending_review
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "null"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(
        path.join(testDir, "no-output-task.md"),
        taskContent,
        "utf-8"
      );
      planReader.invalidateCache();

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("No output recorded");
      expect(content).toContain(`approve(target: "task", id: "no-output-task")`);
    });
  });

  describe("formatChangesTable", () => {
    it("should format changes table with no changes", async () => {
      await planReader.addTask({
        id: "no-changes-task",
        title: "No Changes",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "no-changes-task",
        status: "pending_review",
        task_output: {
          what: "Did work",
          why: "Complete",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "implement",
          changes: [],
          design_decisions: "No changes needed",
          references_used: [],
          references_reason: "",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("no changes recorded");
    });
  });

  describe("parent-child relationship in graph", () => {
    it("should show parent-child relationship with dotted arrow", async () => {
      await planReader.addTask({
        id: "parent-task",
        title: "Parent",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.addTask({
        id: "child-task",
        title: "Child",
        content: "",
        parent: "parent-task",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain("parent_task -.-> child_task");
    });
  });

  describe("parallelizable tasks in graph", () => {
    it("should show parallelizable tasks with rounded brackets", async () => {
      await planReader.addTask({
        id: "parallel-task",
        title: "Parallel",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: true,
        references: [],
      });

      await planReporter.updateGraphFile();

      const content = await fs.readFile(
        path.join(testDir, "GRAPH.md"),
        "utf-8"
      );
      expect(content).toContain('(["Parallel');
    });
  });

  describe("references section formatting", () => {
    it("should format references when present", async () => {
      await planReader.addTask({
        id: "ref-task",
        title: "Ref Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "ref-task",
        status: "pending_review",
        task_output: {
          what: "Done",
          why: "Complete",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "implement",
          changes: [],
          design_decisions: "",
          references_used: ["doc-1", "doc-2"],
          references_reason: "Used for implementation guidance",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("doc-1, doc-2");
      expect(content).toContain("Used for implementation guidance");
    });

    it("should show placeholder when references_reason is empty", async () => {
      await planReader.addTask({
        id: "no-reason-task",
        title: "No Reason Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "no-reason-task",
        status: "pending_review",
        task_output: {
          what: "Done",
          why: "Complete",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "implement",
          changes: [],
          design_decisions: "",
          references_used: ["doc-1"],
          references_reason: "",
        },
      });

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      expect(content).toContain("doc-1");
      expect(content).toContain("(未記入)");
    });
  });

  describe("formatPhaseSection - unknown phase", () => {
    it("should return empty string for unknown phase", async () => {
      await planReader.addTask({
        id: "unknown-phase-task",
        title: "Unknown Phase",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      // Create a task with an unknown phase directly in the file
      const taskContent = `---
id: unknown-phase-task
title: "Unknown Phase"
status: pending_review
parent: ""
dependencies: []
dependency_reason: ""
prerequisites: ""
completion_criteria: ""
deliverables: []
output: ""
task_output: "{\\"what\\":\\"Done\\",\\"why\\":\\"Complete\\",\\"how\\":\\"Manual\\",\\"blockers\\":[],\\"risks\\":[],\\"phase\\":\\"unknown_phase\\",\\"references_used\\":null,\\"references_reason\\":\\"\\"}"
is_parallelizable: false
references: []
feedback: "[]"
created: ${new Date().toISOString()}
updated: ${new Date().toISOString()}
---

Content`;

      await fs.writeFile(
        path.join(testDir, "unknown-phase-task.md"),
        taskContent,
        "utf-8"
      );
      planReader.invalidateCache();

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );
      // Should not throw and should contain the task
      expect(content).toContain("unknown-phase-task");
      expect(content).toContain("Phase: unknown_phase");
    });
  });

  describe("formatPhaseSection - empty field placeholders", () => {
    type EmptyFieldTestCase = {
      phase: string;
      taskId: string;
      taskOutput: Record<string, unknown>;
    };

    const emptyFieldTestCases: EmptyFieldTestCase[] = [
      {
        phase: "verify",
        taskId: "empty-verify-task",
        taskOutput: {
          what: "Verified",
          why: "Done",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "verify",
          test_target: "",
          test_results: "",
          coverage: "",
          references_used: [],
          references_reason: "",
        },
      },
      {
        phase: "fix",
        taskId: "empty-fix-task",
        taskOutput: {
          what: "Fixed",
          why: "Done",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "fix",
          changes: [],
          feedback_addressed: "",
          references_used: [],
          references_reason: "",
        },
      },
      {
        phase: "research",
        taskId: "empty-research-task",
        taskOutput: {
          what: "Researched",
          why: "Done",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "research",
          findings: "",
          sources: [],
          references_used: [],
          references_reason: "",
        },
      },
    ];

    it.each(emptyFieldTestCases)(
      "should show placeholders for empty $phase phase fields",
      async ({ taskId, taskOutput }) => {
        await planReader.addTask({
          id: taskId,
          title: `Empty ${taskOutput.phase} Task`,
          content: "",
          parent: "",
          dependencies: [],
          dependency_reason: "",
          prerequisites: "",
          completion_criteria: "",
          deliverables: [],
          is_parallelizable: false,
          references: [],
        });

        await planReader.updateStatus({
          id: taskId,
          status: "pending_review",
          task_output: taskOutput,
        });

        await planReporter.updatePendingReviewFile();

        const content = await fs.readFile(
          path.join(testDir, "PENDING_REVIEW.md"),
          "utf-8"
        );
        expect(content).toContain("(未記入)");
      }
    );
  });

  describe("updatePendingReviewFile - task not found edge case", () => {
    it("should skip task when getTask returns null (race condition)", async () => {
      // Add a task and set it to pending_review
      await planReader.addTask({
        id: "race-task",
        title: "Race Task",
        content: "",
        parent: "",
        dependencies: [],
        dependency_reason: "",
        prerequisites: "",
        completion_criteria: "",
        deliverables: [],
        is_parallelizable: false,
        references: [],
      });

      await planReader.updateStatus({
        id: "race-task",
        status: "pending_review",
        task_output: {
          what: "Done",
          why: "Complete",
          how: "Manual",
          blockers: [],
          risks: [],
          phase: "implement",
          changes: [],
          design_decisions: "",
          references_used: [],
          references_reason: "",
        },
      });

      // Mock getTask to return null (simulates race condition where task is deleted after listing)
      const originalGetTask = planReader.getTask.bind(planReader);
      let callCount = 0;
      planReader.getTask = async (id: string) => {
        callCount++;
        // Return null for the first call to simulate race condition
        if (id === "race-task") {
          return null;
        }
        return originalGetTask(id);
      };

      await planReporter.updatePendingReviewFile();

      const content = await fs.readFile(
        path.join(testDir, "PENDING_REVIEW.md"),
        "utf-8"
      );

      // The task should NOT be in the file because getTask returned null
      expect(content).not.toContain("race-task");
      expect(callCount).toBe(1);

      // Restore original
      planReader.getTask = originalGetTask;
    });
  });
});
