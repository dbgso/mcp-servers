import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FeedbackEntry, FeedbackDecision, FeedbackStatus } from "../types/index.js";
import { getErrorMessage } from "mcp-shared";
import { z } from "zod";
import { parseFrontmatter, unquote } from "../utils/frontmatter.js";

const optionalText = z.string().nullable().catch(null);

/**
 * A feedback file's fields. `id`, `task_id` and `original` make it feedback;
 * the rest fall back to a fresh draft's values when absent or unreadable.
 */
const FeedbackFrontmatter = z.object({
  id: z.string(),
  task_id: z.string(),
  original: z.string(),
  interpretation: optionalText,
  decision: z.enum(["adopted", "rejected"]).catch("rejected"),
  status: z.enum(["draft", "confirmed"]).catch("draft"),
  timestamp: z.string().min(1).catch(() => new Date().toISOString()),
  addressed_by: optionalText,
}) satisfies z.ZodType<FeedbackEntry, z.ZodTypeDef, unknown>;

/** The last id handed out in this process, shared by every reader. */
let lastIssuedId = 0;

export class FeedbackReader {
  private readonly baseDir: string;

  constructor(planDir: string) {
    // Feedback stored in {planDir}/feedback/{task_id}/
    this.baseDir = path.join(planDir, "feedback");
  }

  private getTaskFeedbackDir(taskId: string): string {
    return path.join(this.baseDir, taskId);
  }

  private getFeedbackPath({ taskId, feedbackId }: { taskId: string; feedbackId: string }): string {
    return path.join(this.getTaskFeedbackDir(taskId), `${feedbackId}.md`);
  }

  /**
   * `fb-<milliseconds>`, but never the same number twice: two feedback entries
   * created within one millisecond used to get the same id, and the second
   * file overwrote the first.
   */
  private generateFeedbackId(): string {
    lastIssuedId = Math.max(Date.now(), lastIssuedId + 1);
    return `fb-${lastIssuedId}`;
  }

  /** Feedback has no boolean or list fields: a value is null, quoted text, or bare text. */
  private parseYamlValue(value: string): string | null {
    if (value === "null") return null;
    const quoted = unquote(value);
    // Undo what serializeFeedback escapes
    if (quoted !== null) return quoted.replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    return value;
  }

  private parseFeedbackFile(content: string): FeedbackEntry | null {
    const parsed = parseFrontmatter({ text: content, parseValue: (raw) => this.parseYamlValue(raw) });
    if (!parsed) return null;
    const { metadata } = parsed;

    const fields = FeedbackFrontmatter.safeParse(metadata);
    return fields.success ? fields.data : null;
  }

  private serializeFeedback(entry: FeedbackEntry): string {
    const escapeYaml = (str: string | null): string => {
      if (str === null) return "null";
      // Escape quotes and newlines for YAML string
      return `"${str.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    };

    return `---
id: ${entry.id}
task_id: ${entry.task_id}
original: ${escapeYaml(entry.original)}
interpretation: ${escapeYaml(entry.interpretation)}
decision: ${entry.decision}
status: ${entry.status}
timestamp: ${entry.timestamp}
addressed_by: ${entry.addressed_by ? escapeYaml(entry.addressed_by) : "null"}
---
`;
  }

  async createDraftFeedback(params: {
    taskId: string;
    original: string;
    decision: FeedbackDecision;
  }): Promise<{ success: boolean; error?: string; feedbackId?: string }> {
    const { taskId, original, decision } = params;
    const feedbackId = this.generateFeedbackId();
    const taskFeedbackDir = this.getTaskFeedbackDir(taskId);

    try {
      // Ensure directory exists
      await fs.mkdir(taskFeedbackDir, { recursive: true });

      const entry: FeedbackEntry = {
        id: feedbackId,
        task_id: taskId,
        original,
        interpretation: null,
        decision,
        status: "draft",
        timestamp: new Date().toISOString(),
        addressed_by: null,
      };

      const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });
      await fs.writeFile(filePath, this.serializeFeedback(entry), "utf-8");

      return { success: true, feedbackId };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create feedback: ${getErrorMessage(error)}`,
      };
    }
  }

  async getFeedback({ taskId, feedbackId }: { taskId: string; feedbackId: string }): Promise<FeedbackEntry | null> {
    const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return this.parseFeedbackFile(content);
    } catch {
      return null;
    }
  }

  async listFeedback(taskId: string): Promise<FeedbackEntry[]> {
    const taskFeedbackDir = this.getTaskFeedbackDir(taskId);

    try {
      const files = await fs.readdir(taskFeedbackDir);
      const entries: FeedbackEntry[] = [];

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const filePath = path.join(taskFeedbackDir, file);
        const content = await fs.readFile(filePath, "utf-8");
        const entry = this.parseFeedbackFile(content);

        if (entry) {
          entries.push(entry);
        }
      }

      // Sort by timestamp (newest first)
      return entries.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
    } catch {
      return [];
    }
  }

  async getUnaddressedFeedback(taskId: string): Promise<FeedbackEntry[]> {
    const allFeedback = await this.listFeedback(taskId);
    return allFeedback.filter(
      (fb) => fb.status === "confirmed" && fb.addressed_by === null
    );
  }

  async getDraftFeedback(taskId: string): Promise<FeedbackEntry[]> {
    const allFeedback = await this.listFeedback(taskId);
    return allFeedback.filter((fb) => fb.status === "draft");
  }

  async addInterpretation(params: {
    taskId: string;
    feedbackId: string;
    interpretation: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { taskId, feedbackId, interpretation } = params;
    const entry = await this.getFeedback({ taskId: taskId, feedbackId: feedbackId });

    if (!entry) {
      return { success: false, error: `Feedback "${feedbackId}" not found.` };
    }

    if (entry.status !== "draft") {
      return { success: false, error: `Feedback "${feedbackId}" is already confirmed.` };
    }

    const updatedEntry: FeedbackEntry = {
      ...entry,
      interpretation,
    };

    const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });
    await fs.writeFile(filePath, this.serializeFeedback(updatedEntry), "utf-8");

    return { success: true };
  }

  async confirmFeedback(params: {
    taskId: string;
    feedbackId: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { taskId, feedbackId } = params;
    const entry = await this.getFeedback({ taskId: taskId, feedbackId: feedbackId });

    if (!entry) {
      return { success: false, error: `Feedback "${feedbackId}" not found.` };
    }

    if (entry.status === "confirmed") {
      return { success: false, error: `Feedback "${feedbackId}" is already confirmed.` };
    }

    if (!entry.interpretation) {
      return { success: false, error: `Feedback "${feedbackId}" has no interpretation. AI must add interpretation before confirmation.` };
    }

    const updatedEntry: FeedbackEntry = {
      ...entry,
      status: "confirmed",
    };

    const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });
    await fs.writeFile(filePath, this.serializeFeedback(updatedEntry), "utf-8");

    return { success: true };
  }

  async markAsAddressed(params: {
    taskId: string;
    feedbackId: string;
    addressedBy: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { taskId, feedbackId, addressedBy } = params;
    const entry = await this.getFeedback({ taskId: taskId, feedbackId: feedbackId });

    if (!entry) {
      return { success: false, error: `Feedback "${feedbackId}" not found.` };
    }

    if (entry.status !== "confirmed") {
      return { success: false, error: `Feedback "${feedbackId}" is not confirmed yet.` };
    }

    const updatedEntry: FeedbackEntry = {
      ...entry,
      addressed_by: addressedBy,
    };

    const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });
    await fs.writeFile(filePath, this.serializeFeedback(updatedEntry), "utf-8");

    return { success: true };
  }

  async deleteFeedback(params: {
    taskId: string;
    feedbackId: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { taskId, feedbackId } = params;
    const filePath = this.getFeedbackPath({ taskId: taskId, feedbackId: feedbackId });

    try {
      await fs.unlink(filePath);
      return { success: true };
    } catch {
      return { success: false, error: `Feedback "${feedbackId}" not found.` };
    }
  }

  async clearTaskFeedback(taskId: string): Promise<{ success: boolean; count: number }> {
    const taskFeedbackDir = this.getTaskFeedbackDir(taskId);

    try {
      const files = await fs.readdir(taskFeedbackDir);
      let count = 0;

      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        await fs.unlink(path.join(taskFeedbackDir, file));
        count++;
      }

      // Try to remove the directory if empty
      try {
        await fs.rmdir(taskFeedbackDir);
      } catch {
        // Directory might not be empty, ignore
      }

      return { success: true, count };
    } catch {
      return { success: true, count: 0 };
    }
  }
}
