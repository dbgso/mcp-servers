import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Task, TaskOutput, FeedbackEntry } from "../types/index.js";
import type { PlanReader } from "./plan-reader.js";
import type { FeedbackReader } from "./feedback-reader.js";
import { blockersAndRisks, phaseSections, renderSections, reviewCommands } from "./task-presentation.js";
import { renderTaskGraph } from "./task-graph.js";

interface TaskWithFeedback {
  task: Task;
  feedbackList: FeedbackEntry[];
}

export interface PendingReview {
  reviews: TaskWithFeedback[];
  feedbackOnly: TaskWithFeedback[];
}

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
    const content = this.renderPendingReview(await this.fetchPendingReview());
    const filePath = path.join(this.directory, "PENDING_REVIEW.md");
    await fs.writeFile(filePath, content, "utf-8");
  }

  /**
   * What PENDING_REVIEW.md shows: the pending_review tasks with their feedback,
   * then the tasks that are not pending review but have feedback ready for
   * approval. A task listed but no longer readable is left out.
   */
  private async fetchPendingReview(): Promise<PendingReview> {
    const tasks = await this.planReader.listTasks();
    const feedbackByTask = await this.getFeedbackByTask(tasks.map((t) => t.id));

    const reviews: TaskWithFeedback[] = [];
    for (const summary of tasks.filter((t) => t.status === "pending_review")) {
      const task = await this.planReader.getTask(summary.id);
      if (task) {
        reviews.push({ task, feedbackList: feedbackByTask.get(task.id) ?? [] });
        feedbackByTask.delete(task.id); // Shown with the review, so not again below
      }
    }

    // feedback.length is always > 0 because getFeedbackByTask only adds entries with feedback
    const feedbackOnly: TaskWithFeedback[] = [];
    for (const [taskId, feedbackList] of feedbackByTask) {
      const task = await this.planReader.getTask(taskId);
      if (task) {
        feedbackOnly.push({ task, feedbackList });
      }
    }

    return { reviews, feedbackOnly };
  }

  /** PENDING_REVIEW.md's text. No I/O. */
  renderPendingReview(params: PendingReview): string {
    const { reviews, feedbackOnly } = params;
    const parts = [
      ...reviews.map((entry) => this.formatTaskReport(entry)),
      ...feedbackOnly.map((entry) => this.formatTaskWithFeedbackOnly(entry)),
    ];
    const body = parts.length > 0 ? parts : ["_No tasks pending review._\n"];
    return ["# Pending Review Tasks\n", ...body].join("\n");
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

Approve: \`${reviewCommands(task.id).approve}\`

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

Approve: \`${reviewCommands(task.id).approve}\`

---

`;
  }

  private formatBlockersRisks(output: TaskOutput): string {
    return renderSections({ sections: blockersAndRisks(output), level: 3 });
  }

  async updateGraphFile(): Promise<void> {
    const tasks = await this.planReader.listTasks();
    const blockedIds = new Set((await this.planReader.getBlockedTasks()).map((t) => t.id));
    const filePath = path.join(this.directory, "GRAPH.md");
    await fs.writeFile(filePath, renderTaskGraph({ tasks, blockedIds }) + "\n", "utf-8");
  }

  async updateAll(): Promise<void> {
    await Promise.all([
      this.updatePendingReviewFile(),
      this.updateGraphFile(),
    ]);
  }
}
