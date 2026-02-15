import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Task, TaskOutput } from "../types/index.js";
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
    const output = task.task_output;

    if (!output) {
      return `## ${task.id}: ${task.title}

_No output recorded._

---

承認: \`approve(target: "task", id: "${task.id}")\`

---

`;
    }

    // Format phase-specific section
    const phaseSection = this.formatPhaseSection(output);

    // Format blockers & risks
    const blockersRisks = this.formatBlockersRisks(output);

    // Format references section
    const referencesSection = (() => {
      if (!output.references_used || output.references_used.length === 0) {
        return `- **参照なし**\n- **理由**: ${output.references_reason || "(未記入)"}`;
      }
      return `- **参照**: ${output.references_used.join(", ")}\n- **理由**: ${output.references_reason || "(未記入)"}`;
    })();

    return `## ${task.id}: ${task.title}

### Phase: ${output.phase}

### What (何をしたか)
${output.what}

### Why (なぜこれで十分か)
${output.why}

### How (どのように行ったか)
${output.how}

${phaseSection}

${blockersRisks}

### References
${referencesSection}

---

**Completion criteria**: ${task.completion_criteria || "(未設定)"}

承認: \`approve(target: "task", id: "${task.id}")\`

---

`;
  }

  private formatPhaseSection(output: TaskOutput): string {
    switch (output.phase) {
      case "research":
        return `### Findings (調査結果)
${output.findings || "(未記入)"}

### Sources (調査ソース)
${output.sources?.map((s) => `- ${s}`).join("\n") || "- (なし)"}`;

      case "implement":
        return `### Changes (ファイル変更)
${this.formatChangesTable(output.changes)}

### Design Decisions (設計判断)
${output.design_decisions || "(未記入)"}`;

      case "verify":
        return `### Test Target (テスト対象)
${output.test_target || "(未記入)"}

### Test Results (テスト結果)
${output.test_results || "(未記入)"}

### Coverage (網羅性)
${output.coverage || "(未記入)"}`;

      case "fix":
        return `### Changes (ファイル変更)
${this.formatChangesTable(output.changes)}

### Feedback Addressed (対応したフィードバック)
${output.feedback_addressed || "(未記入)"}`;

      default:
        return "";
    }
  }

  private formatChangesTable(changes: TaskOutput["changes"]): string {
    if (!changes || changes.length === 0) {
      return "| File | Lines | Changes |\n|------|-------|---------|\n| _(no changes recorded)_ | - | - |";
    }
    const rows = changes.map(
      (c) => `| \`${c.file}\` | ${c.lines} | ${c.description} |`
    );
    return `| File | Lines | Changes |\n|------|-------|---------|\n${rows.join("\n")}`;
  }

  private formatBlockersRisks(output: TaskOutput): string {
    const blockers = output.blockers?.length
      ? output.blockers.map((b) => `- ${b}`).join("\n")
      : "- なし";
    const risks = output.risks?.length
      ? output.risks.map((r) => `- ${r}`).join("\n")
      : "- なし";

    return `### Blockers (遭遇した障害)
${blockers}

### Risks (リスク・懸念事項)
${risks}`;
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
