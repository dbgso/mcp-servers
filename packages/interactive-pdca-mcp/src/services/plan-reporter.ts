import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Task, TaskOutput, TaskStatus, FeedbackEntry } from "../types/index.js";
import type { PlanReader } from "./plan-reader.js";
import type { FeedbackReader } from "./feedback-reader.js";
import { phaseSections, renderSections, STATUS_STYLE, statusLookup } from "./task-presentation.js";

const STATUS_ICON: Record<TaskStatus, string> = {
  completed: "[done]",
  self_review: "[self-review]",
  pending_review: "[review]",
  in_progress: "[wip]",
  blocked: "[blocked]",
  skipped: "[skip]",
  pending: "[pending]",
};

export class PlanReporter {
  private readonly directory: string;
  private readonly planReader: PlanReader;
  private readonly feedbackReader: FeedbackReader | null;

  constructor(directory: string, planReader: PlanReader, feedbackReader?: FeedbackReader) {
    this.directory = directory;
    this.planReader = planReader;
    this.feedbackReader = feedbackReader ?? null;
  }

  async updatePendingReviewFile(): Promise<void> {
    const tasks = await this.planReader.listTasks();
    const pendingReview = tasks.filter((t) => t.status === "pending_review");

    // Get all pending feedback grouped by task
    const feedbackByTask = await this.getFeedbackByTask(tasks.map(t => t.id));

    const contentParts: string[] = ["# Pending Review Tasks\n"];

    if (pendingReview.length === 0 && feedbackByTask.size === 0) {
      contentParts.push("_No tasks pending review._\n");
    } else {
      // First, show pending_review tasks with their feedback
      for (const summary of pendingReview) {
        const task = await this.planReader.getTask(summary.id);
        if (task) {
          const taskFeedback = feedbackByTask.get(task.id) ?? [];
          contentParts.push(this.formatTaskReport({ task: task, feedbackList: taskFeedback }));
          feedbackByTask.delete(task.id); // Remove so we don't show it again
        }
      }

      // Then, show tasks that have pending feedback but are not pending_review
      // Note: feedback.length is always > 0 because getFeedbackByTask only adds entries with feedback
      for (const [taskId, feedback] of feedbackByTask) {
        const task = await this.planReader.getTask(taskId);
        if (task) {
          contentParts.push(this.formatTaskWithFeedbackOnly({ task: task, feedbackList: feedback }));
        }
      }
    }

    const filePath = path.join(this.directory, "PENDING_REVIEW.md");
    await fs.writeFile(filePath, contentParts.join("\n"), "utf-8");
  }

  private async getFeedbackByTask(taskIds: string[]): Promise<Map<string, FeedbackEntry[]>> {
    const result = new Map<string, FeedbackEntry[]>();

    if (!this.feedbackReader) {
      return result;
    }

    for (const taskId of taskIds) {
      const drafts = await this.feedbackReader.getDraftFeedback(taskId);
      // Only include drafts that have interpretation (ready for approval)
      const readyForApproval = drafts.filter(fb => fb.interpretation !== null);
      if (readyForApproval.length > 0) {
        // Sort by timestamp (newest first)
        readyForApproval.sort((a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        result.set(taskId, readyForApproval);
      }
    }

    return result;
  }

  private formatFeedbackSection(feedbackList?: FeedbackEntry[]): string {
    if (!feedbackList || feedbackList.length === 0) {
      return "";
    }

    const items = feedbackList.map(fb => `#### ${fb.id}

**Original:**
${fb.original}

**Interpretation:**
${fb.interpretation}

Approve: \`approve(target: "feedback", task_id: "${fb.task_id}", feedback_id: "${fb.id}")\``);

    return `### Pending Feedback

${items.join("\n\n")}`;
  }

  private formatTaskWithFeedbackOnly({ task, feedbackList }: { task: Task; feedbackList: FeedbackEntry[] }): string {
    return `## ${task.id}: ${task.title}

_Task is not pending review, but has pending feedback._

${this.formatFeedbackSection(feedbackList)}

---

`;
  }

  private formatTaskReport({ task, feedbackList }: { task: Task; feedbackList?: FeedbackEntry[] }): string {
    const output = task.task_output;

    if (!output) {
      const feedbackSection = this.formatFeedbackSection(feedbackList);
      const feedbackPart = feedbackSection ? `\n${feedbackSection}\n` : "";

      // Show task content even without output
      const contentSection = task.content ? `### Content\n${task.content}\n` : "_No output recorded._\n";

      return `## ${task.id}: ${task.title}

${contentSection}
${feedbackPart}
---

Approve: \`approve(target: "task", id: "${task.id}")\`

---

`;
    }

    // Format phase-specific section
    const phaseSection = renderSections({ sections: phaseSections(output), level: 3 });

    // Format blockers & risks
    const blockersRisks = this.formatBlockersRisks(output);

    // Format references section
    const referencesSection = (() => {
      if (!output.references_used || output.references_used.length === 0) {
        return `- **No references**\n- **Reason**: ${output.references_reason || "(not recorded)"}`;
      }
      return `- **References**: ${output.references_used.join(", ")}\n- **Reason**: ${output.references_reason || "(not recorded)"}`;
    })();

    const feedbackSection = this.formatFeedbackSection(feedbackList);
    const feedbackPart = feedbackSection ? `\n${feedbackSection}\n` : "";

    // Include task content if present
    const contentSection = task.content ? `### Content\n${task.content}\n\n` : "";

    return `## ${task.id}: ${task.title}

### Phase: ${output.phase}

${contentSection}### What
${output.what}

### Why
${output.why}

### How
${output.how}

${phaseSection}

${blockersRisks}

### References
${referencesSection}
${feedbackPart}
---

**Completion criteria**: ${task.completion_criteria || "(not set)"}

Approve: \`approve(target: "task", id: "${task.id}")\`

---

`;
  }

  private formatBlockersRisks(output: TaskOutput): string {
    const blockers = output.blockers?.length
      ? output.blockers.map((b) => `- ${b}`).join("\n")
      : "- None";
    const risks = output.risks?.length
      ? output.risks.map((r) => `- ${r}`).join("\n")
      : "- None";

    return `### Blockers
${blockers}

### Risks
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
      const icon = statusLookup({ table: STATUS_ICON, status: task.status });
      // Escape quotes in title and wrap in quotes for Mermaid compatibility
      const escapedTitle = task.title.replace(/"/g, '\\"');
      const label = `"${escapedTitle} ${icon}"`;
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
      const style = statusLookup({ table: STATUS_STYLE, status: task.status });
      lines.push(`  style ${safeId} ${style}`);
    }

    lines.push("```");
    lines.push("");
    lines.push("## Legend");
    lines.push("- completed");
    lines.push("- self_review");
    lines.push("- pending_review");
    lines.push("- in_progress");
    lines.push("- pending/ready");
    lines.push("- blocked");
    lines.push("- skipped");
    lines.push("- `[ ]` sequential");
    lines.push("- `([ ])` parallelizable");
    lines.push("- `-->` dependency");
    lines.push("- `-.->` parent-child");

    const content = lines.join("\n") + "\n";
    const filePath = path.join(this.directory, "GRAPH.md");
    await fs.writeFile(filePath, content, "utf-8");
  }

  async updateAll(): Promise<void> {
    await Promise.all([
      this.updatePendingReviewFile(),
      this.updateGraphFile(),
    ]);
  }
}
