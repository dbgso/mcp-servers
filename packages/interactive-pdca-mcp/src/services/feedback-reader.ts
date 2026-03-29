import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { FeedbackEntry, FeedbackDecision, FeedbackStatus } from "../types/index.js";
import { getErrorMessage } from "mcp-shared";

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

  private generateFeedbackId(): string {
    const timestamp = Date.now();
    return `fb-${timestamp}`;
  }

  private parseYamlValue(value: string): string | boolean | null {
    value = value.trim();

    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "null") return null;

    // Remove quotes if present
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      // Unescape common escape sequences
      return value.slice(1, -1).replace(/\\n/g, "\n").replace(/\\t/g, "\t");
    }

    return value;
  }

  private parseFeedbackFile(content: string): FeedbackEntry | null {
    const frontmatterMatch = content.match(
      /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/
    );

    if (!frontmatterMatch) {
      return null;
    }

    const [, yaml] = frontmatterMatch;
    const metadata: Record<string, unknown> = {};

    for (const line of yaml.split("\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;

      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      metadata[key] = this.parseYamlValue(value);
    }

    // Validate required fields
    if (
      typeof metadata.id !== "string" ||
      typeof metadata.task_id !== "string" ||
      typeof metadata.original !== "string"
    ) {
      return null;
    }

    return {
      id: metadata.id,
      task_id: metadata.task_id,
      original: metadata.original,
      interpretation: metadata.interpretation as string | null,
      decision: (metadata.decision as FeedbackDecision) || "rejected",
      status: (metadata.status as FeedbackStatus) || "draft",
      timestamp: (metadata.timestamp as string) || new Date().toISOString(),
      addressed_by: metadata.addressed_by as string | null,
    };
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
