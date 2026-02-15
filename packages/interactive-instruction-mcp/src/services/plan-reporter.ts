import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Task } from "../types/index.js";
import type { PlanReader } from "./plan-reader.js";

export class PlanReporter {
  private readonly directory: string;
  private readonly planReader: PlanReader;

  constructor(directory: string, planReader: PlanReader) {
    this.directory = directory;
    this.planReader = planReader;
  }

  async updatePendingReviewFile(): Promise<void> {
    const tasks = await this.planReader.listTasks();
    const pendingReview = tasks.filter((t) => t.status === "pending_review");

    const contentParts: string[] = ["# Pending Review Tasks\n"];

    if (pendingReview.length === 0) {
      contentParts.push("_No tasks pending review._\n");
    } else {
      for (const summary of pendingReview) {
        const task = await this.planReader.getTask(summary.id);
        if (task) {
          contentParts.push(this.formatTaskReport(task));
        }
      }
    }

    const filePath = path.join(this.directory, "PENDING_REVIEW.md");
    await fs.writeFile(filePath, contentParts.join("\n"), "utf-8");
  }

  private formatTaskReport(task: Task): string {
    const report = task.review_report;

    // Format changes table
    const changesTable = (() => {
      if (!report?.changes || report.changes.length === 0) {
        return "| File | Lines | Changes |\n|------|-------|---------|\n| _(no changes recorded)_ | - | - |";
      }
      const rows = report.changes.map(
        (c) => `| \`${c.file}\` | ${c.lines} | ${c.description} |`
      );
      return `| File | Lines | Changes |\n|------|-------|---------|\n${rows.join("\n")}`;
    })();

    // Format references section
    const referencesSection = (() => {
      if (!report) {
        return "- **参照なし**\n- **理由**: (未記入)";
      }
      if (report.references_used === null || report.references_used.length === 0) {
        return `- **参照なし**\n- **理由**: ${report.references_reason || "(未記入)"}`;
      }
      return `- **参照**: ${report.references_used.join(", ")}\n- **理由**: ${report.references_reason || "(未記入)"}`;
    })();

    return `## ${task.id}: ${task.title}

### 1. What (具体的な成果物)

${changesTable}

### 2. Why (完了条件との対応)

- **Completion criteria**: ${task.completion_criteria || "(未設定)"}
- **満たす理由**: ${report?.why || "(未記入)"}

### 3. References

${referencesSection}

---

承認: \`plan(action: "approve", id: "${task.id}")\`

---

`;
  }

  async updateGraphFile(): Promise<void> {
    const tasks = await this.planReader.listTasks();
    const allTasks = await Promise.all(
      tasks.map((t) => this.planReader.getTask(t.id))
    );
    const taskMap = new Map(
      allTasks.filter((t): t is Task => t !== null).map((t) => [t.id, t])
    );

    const lines: string[] = ["# Task Graph", "", "```mermaid", "flowchart LR"];

    // Define nodes
    for (const task of tasks) {
      const icon = this.getStatusIcon(task.status);
      const label = `${task.title} ${icon}`;
      const nodeShape = task.is_parallelizable
        ? `([${label}])`
        : `[${label}]`;
      const safeId = task.id.replace(/-/g, "_");
      lines.push(`  ${safeId}${nodeShape}`);
    }

    lines.push("");

    // Define edges (dependencies)
    for (const task of tasks) {
      const fullTask = taskMap.get(task.id);
      if (fullTask && fullTask.dependencies.length > 0) {
        for (const dep of fullTask.dependencies) {
          const safeId = task.id.replace(/-/g, "_");
          const safeDep = dep.replace(/-/g, "_");
          lines.push(`  ${safeDep} --> ${safeId}`);
        }
      }
      // Also show parent relationship
      if (fullTask && fullTask.parent) {
        const safeId = task.id.replace(/-/g, "_");
        const safeParent = fullTask.parent.replace(/-/g, "_");
        lines.push(`  ${safeParent} -.-> ${safeId}`);
      }
    }

    lines.push("");
    lines.push("  %% Styling");

    // Add styling
    for (const task of tasks) {
      const safeId = task.id.replace(/-/g, "_");
      const style = this.getStatusStyle(task.status);
      lines.push(`  style ${safeId} ${style}`);
    }

    lines.push("```");
    lines.push("");
    lines.push("## Legend");
    lines.push("- ✓ completed");
    lines.push("- ⏳ pending_review");
    lines.push("- ● in_progress");
    lines.push("- ○ pending/ready");
    lines.push("- ◇ blocked");
    lines.push("- ⊘ skipped");
    lines.push("- `[ ]` sequential");
    lines.push("- `([ ])` parallelizable");
    lines.push("- `-->` dependency");
    lines.push("- `-.->` parent-child");

    const content = lines.join("\n") + "\n";
    const filePath = path.join(this.directory, "GRAPH.md");
    await fs.writeFile(filePath, content, "utf-8");
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✓";
      case "pending_review":
        return "⏳";
      case "in_progress":
        return "●";
      case "blocked":
        return "◇";
      case "skipped":
        return "⊘";
      default:
        return "○";
    }
  }

  private getStatusStyle(status: string): string {
    switch (status) {
      case "completed":
        return "fill:#90EE90,stroke:#228B22";
      case "pending_review":
        return "fill:#DDA0DD,stroke:#8B008B";
      case "in_progress":
        return "fill:#87CEEB,stroke:#4682B4";
      case "blocked":
        return "fill:#FFB6C1,stroke:#DC143C";
      case "skipped":
        return "fill:#D3D3D3,stroke:#808080";
      default:
        return "fill:#FFFACD,stroke:#DAA520";
    }
  }

  async updateAll(): Promise<void> {
    await Promise.all([
      this.updatePendingReviewFile(),
      this.updateGraphFile(),
    ]);
  }
}
