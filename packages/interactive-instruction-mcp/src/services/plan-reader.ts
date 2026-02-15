import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Task,
  TaskStatus,
  TaskSummary,
  Feedback,
  FeedbackDecision,
  FileChange,
  ReviewReport,
  PlanReader as IPlanReader,
} from "../types/index.js";

export class PlanReader implements IPlanReader {
  private readonly directory: string;
  private cache: Map<string, Task> | null = null;
  private cacheTime: number = 0;
  private readonly CACHE_TTL = 60000; // 1 minute

  constructor(directory: string) {
    this.directory = directory;
  }

  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.directory, { recursive: true });
    } catch {
      // Directory might already exist
    }
  }

  private idToPath(id: string): string {
    return path.join(this.directory, `${id}.md`);
  }

  private pathToId(filePath: string): string {
    return path.basename(filePath, ".md");
  }

  private parseYamlValue(value: string): string | boolean | string[] {
    value = value.trim();

    // Boolean
    if (value === "true") return true;
    if (value === "false") return false;

    // Array
    if (value.startsWith("[") && value.endsWith("]")) {
      const inner = value.slice(1, -1).trim();
      if (!inner) return [];
      return inner.split(",").map((item) => {
        const trimmed = item.trim();
        // Remove quotes if present
        if (
          (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
          (trimmed.startsWith("'") && trimmed.endsWith("'"))
        ) {
          return trimmed.slice(1, -1);
        }
        return trimmed;
      });
    }

    // String (remove quotes if present)
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      return value.slice(1, -1);
    }

    return value;
  }

  private parseTaskFile(fileContent: string): Task | null {
    const frontmatterMatch = fileContent.match(
      /^---\n([\s\S]*?)\n---\n([\s\S]*)$/
    );
    if (!frontmatterMatch) return null;

    const [, yaml, content] = frontmatterMatch;
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
      typeof metadata.title !== "string" ||
      typeof metadata.status !== "string"
    ) {
      return null;
    }

    // Parse feedback from JSON string if present (unescape quotes first)
    const feedback: Feedback[] = (() => {
      if (typeof metadata.feedback === "string" && metadata.feedback) {
        try {
          const unescaped = metadata.feedback.replace(/\\"/g, '"');
          return JSON.parse(unescaped);
        } catch {
          return [];
        }
      }
      return [];
    })();

    // Parse review_report from JSON string if present (unescape quotes first)
    const review_report: ReviewReport | null = (() => {
      if (typeof metadata.review_report === "string" && metadata.review_report) {
        try {
          const unescaped = metadata.review_report.replace(/\\"/g, '"');
          return JSON.parse(unescaped);
        } catch {
          return null;
        }
      }
      return null;
    })();

    return {
      id: metadata.id as string,
      title: metadata.title as string,
      status: metadata.status as TaskStatus,
      parent: (metadata.parent as string) || "",
      dependencies: (metadata.dependencies as string[]) || [],
      dependency_reason: (metadata.dependency_reason as string) || "",
      prerequisites: (metadata.prerequisites as string) || "",
      completion_criteria: (metadata.completion_criteria as string) || "",
      deliverables: (metadata.deliverables as string[]) || [],
      output: (metadata.output as string) || "",
      review_report,
      is_parallelizable: (metadata.is_parallelizable as boolean) || false,
      references: (metadata.references as string[]) || [],
      feedback,
      created: (metadata.created as string) || new Date().toISOString(),
      updated: (metadata.updated as string) || new Date().toISOString(),
      content: content.trim(),
    };
  }

  private serializeTask(task: Task): string {
    const deps =
      task.dependencies.length > 0
        ? `[${task.dependencies.map((d) => `"${d}"`).join(", ")}]`
        : "[]";
    const refs =
      task.references.length > 0
        ? `[${task.references.map((r) => `"${r}"`).join(", ")}]`
        : "[]";
    const delivs =
      task.deliverables.length > 0
        ? `[${task.deliverables.map((d) => `"${d}"`).join(", ")}]`
        : "[]";
    // Escape double quotes in JSON for YAML string
    const feedbackJson = JSON.stringify(task.feedback || []).replace(/"/g, '\\"');
    const reviewReportJson = JSON.stringify(task.review_report).replace(/"/g, '\\"');

    return `---
id: ${task.id}
title: "${task.title}"
status: ${task.status}
parent: "${task.parent}"
dependencies: ${deps}
dependency_reason: "${task.dependency_reason}"
prerequisites: "${task.prerequisites}"
completion_criteria: "${task.completion_criteria}"
deliverables: ${delivs}
output: "${task.output}"
review_report: "${reviewReportJson}"
is_parallelizable: ${task.is_parallelizable}
references: ${refs}
feedback: "${feedbackJson}"
created: ${task.created}
updated: ${task.updated}
---

${task.content}`;
  }

  invalidateCache(): void {
    this.cache = null;
    this.cacheTime = 0;
  }

  private appendReviewReportToContent(params: {
    originalContent: string;
    report: ReviewReport;
  }): string {
    const { originalContent, report } = params;
    const changesTable = report.changes
      .map((c) => `| \`${c.file}\` | ${c.lines} | ${c.description} |`)
      .join("\n");

    const referencesSection =
      report.references_used === null || report.references_used.length === 0
        ? `- 参照なし\n- 理由: ${report.references_reason}`
        : `- 参照: ${report.references_used.join(", ")}\n- 理由: ${report.references_reason}`;

    const reviewMarkdown = `

---

## 完了報告

### 1. What (具体的な成果物)

| File | Lines | Changes |
|------|-------|---------|
${changesTable}

### 2. Why (完了条件との対応)

${report.why}

### 3. References

${referencesSection}
`;

    return originalContent + reviewMarkdown;
  }

  private async loadCache(): Promise<Map<string, Task>> {
    const now = Date.now();
    if (this.cache && now - this.cacheTime < this.CACHE_TTL) {
      return this.cache;
    }

    const tasks = new Map<string, Task>();

    try {
      await this.ensureDirectory();
      const files = await fs.readdir(this.directory);

      for (const file of files) {
        if (!file.endsWith(".md")) continue;

        const filePath = path.join(this.directory, file);
        const content = await fs.readFile(filePath, "utf-8");
        const task = this.parseTaskFile(content);

        if (task) {
          tasks.set(task.id, task);
        }
      }
    } catch {
      // Directory might not exist yet
    }

    this.cache = tasks;
    this.cacheTime = now;
    return tasks;
  }

  async listTasks(): Promise<TaskSummary[]> {
    const tasks = await this.loadCache();
    return Array.from(tasks.values()).map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      parent: task.parent,
      dependencies: task.dependencies,
      is_parallelizable: task.is_parallelizable,
    }));
  }

  async getTask(id: string): Promise<Task | null> {
    const tasks = await this.loadCache();
    return tasks.get(id) || null;
  }

  async taskExists(id: string): Promise<boolean> {
    const tasks = await this.loadCache();
    return tasks.has(id);
  }

  async addTask(params: {
    id: string;
    title: string;
    content: string;
    parent: string;
    dependencies: string[];
    dependency_reason: string;
    prerequisites: string;
    completion_criteria: string;
    deliverables: string[];
    is_parallelizable: boolean;
    references: string[];
  }): Promise<{ success: boolean; error?: string; path?: string }> {
    await this.ensureDirectory();

    // Check if task already exists
    if (await this.taskExists(params.id)) {
      return { success: false, error: `Task "${params.id}" already exists.` };
    }

    // Validate parent exists if specified
    if (params.parent && !(await this.taskExists(params.parent))) {
      return {
        success: false,
        error: `Parent task "${params.parent}" not found. Create the parent task first.`,
      };
    }

    // Validate dependencies
    const validation = await this.validateDependencies({
      taskId: params.id,
      dependencies: params.dependencies,
    });
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    const now = new Date().toISOString();
    const task: Task = {
      id: params.id,
      title: params.title,
      status: "pending",
      parent: params.parent,
      dependencies: params.dependencies,
      dependency_reason: params.dependency_reason,
      prerequisites: params.prerequisites,
      completion_criteria: params.completion_criteria,
      deliverables: params.deliverables,
      output: "",
      review_report: null,
      is_parallelizable: params.is_parallelizable,
      references: params.references,
      feedback: [],
      created: now,
      updated: now,
      content: params.content,
    };

    const filePath = this.idToPath(params.id);
    await fs.writeFile(filePath, this.serializeTask(task), "utf-8");
    this.invalidateCache();

    return { success: true, path: filePath };
  }

  async updateTask(params: {
    id: string;
    title?: string;
    content?: string;
    dependencies?: string[];
    dependency_reason?: string;
    prerequisites?: string;
    completion_criteria?: string;
    is_parallelizable?: boolean;
    references?: string[];
  }): Promise<{ success: boolean; error?: string }> {
    const task = await this.getTask(params.id);
    if (!task) {
      return { success: false, error: `Task "${params.id}" not found.` };
    }

    // Validate new dependencies if provided
    if (params.dependencies) {
      const validation = await this.validateDependencies({
        taskId: params.id,
        dependencies: params.dependencies,
      });
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }
    }

    const updatedTask: Task = {
      ...task,
      title: params.title ?? task.title,
      content: params.content ?? task.content,
      dependencies: params.dependencies ?? task.dependencies,
      dependency_reason: params.dependency_reason ?? task.dependency_reason,
      prerequisites: params.prerequisites ?? task.prerequisites,
      completion_criteria: params.completion_criteria ?? task.completion_criteria,
      is_parallelizable: params.is_parallelizable ?? task.is_parallelizable,
      references: params.references ?? task.references,
      updated: new Date().toISOString(),
    };

    const filePath = this.idToPath(params.id);
    await fs.writeFile(filePath, this.serializeTask(updatedTask), "utf-8");
    this.invalidateCache();

    return { success: true };
  }

  async updateStatus(params: {
    id: string;
    status: TaskStatus;
    output?: string;
    changes?: FileChange[];
    why?: string;
    references_used?: string[] | null;
    references_reason?: string;
  }): Promise<{ success: boolean; error?: string; actualStatus?: TaskStatus }> {
    const { id, status, output, changes, why, references_used, references_reason } = params;
    const task = await this.getTask(id);
    if (!task) {
      return { success: false, error: `Task "${id}" not found.` };
    }

    // Check if dependencies are satisfied when starting
    if (status === "in_progress") {
      const blockedTasks = await this.getBlockedTasks();
      const isBlocked = blockedTasks.some((t) => t.id === id);
      if (isBlocked) {
        const incompleteDeps = await this.getIncompleteDependencies(id);
        return {
          success: false,
          error: `Cannot start task: dependencies not completed. Waiting on: ${incompleteDeps.join(", ")}`,
        };
      }
    }

    // Auto-convert "completed" to "pending_review" for review workflow
    const actualStatus = status === "completed" ? "pending_review" : status;

    // Build review_report when completing a task
    const review_report: ReviewReport | null =
      status === "completed" && changes && why && references_reason !== undefined
        ? {
            changes,
            why,
            references_used: references_used ?? null,
            references_reason: references_reason ?? "",
          }
        : task.review_report;

    // Append review report as markdown to content when completing
    const updatedContent =
      status === "completed" && review_report
        ? this.appendReviewReportToContent({ originalContent: task.content, report: review_report })
        : task.content;

    const updatedTask: Task = {
      ...task,
      status: actualStatus,
      output: output ?? task.output,
      review_report,
      content: updatedContent,
      updated: new Date().toISOString(),
    };

    const filePath = this.idToPath(id);
    await fs.writeFile(filePath, this.serializeTask(updatedTask), "utf-8");
    this.invalidateCache();

    return { success: true, actualStatus };
  }

  async approveTask(id: string): Promise<{ success: boolean; error?: string }> {
    const task = await this.getTask(id);
    if (!task) {
      return { success: false, error: `Task "${id}" not found.` };
    }

    if (task.status !== "pending_review") {
      return {
        success: false,
        error: `Task "${id}" is not pending review. Current status: ${task.status}`,
      };
    }

    // Check if all child tasks are completed
    const childTasks = await this.getChildTasks(id);
    const incompleteChildren = childTasks.filter(
      (child) => child.status !== "completed"
    );
    if (incompleteChildren.length > 0) {
      return {
        success: false,
        error: `Cannot complete: child tasks not finished. Incomplete: ${incompleteChildren.map((c) => c.id).join(", ")}`,
      };
    }

    const updatedTask: Task = {
      ...task,
      status: "completed",
      updated: new Date().toISOString(),
    };

    const filePath = this.idToPath(id);
    await fs.writeFile(filePath, this.serializeTask(updatedTask), "utf-8");
    this.invalidateCache();

    return { success: true };
  }

  async addFeedback(params: {
    id: string;
    comment: string;
    decision: FeedbackDecision;
  }): Promise<{ success: boolean; error?: string }> {
    const task = await this.getTask(params.id);
    if (!task) {
      return { success: false, error: `Task "${params.id}" not found.` };
    }

    const newFeedback: Feedback = {
      comment: params.comment,
      decision: params.decision,
      timestamp: new Date().toISOString(),
    };

    const updatedTask: Task = {
      ...task,
      feedback: [...task.feedback, newFeedback],
      updated: new Date().toISOString(),
    };

    const filePath = this.idToPath(params.id);
    await fs.writeFile(filePath, this.serializeTask(updatedTask), "utf-8");
    this.invalidateCache();

    return { success: true };
  }

  async getChildTasks(parentId: string): Promise<TaskSummary[]> {
    const tasks = await this.loadCache();
    const children: TaskSummary[] = [];

    for (const task of tasks.values()) {
      if (task.parent === parentId) {
        children.push({
          id: task.id,
          title: task.title,
          status: task.status,
          parent: task.parent,
          dependencies: task.dependencies,
          is_parallelizable: task.is_parallelizable,
        });
      }
    }

    return children;
  }

  async deleteTask(id: string): Promise<{ success: boolean; error?: string }> {
    const task = await this.getTask(id);
    if (!task) {
      return { success: false, error: `Task "${id}" not found.` };
    }

    // Check if other tasks depend on this
    const dependents = await this.getDependents(id);
    if (dependents.length > 0) {
      return {
        success: false,
        error: `Cannot delete: other tasks depend on this. Dependents: ${dependents.join(", ")}`,
      };
    }

    const filePath = this.idToPath(id);
    await fs.unlink(filePath);
    this.invalidateCache();

    return { success: true };
  }

  async clearAllTasks(): Promise<{
    success: boolean;
    error?: string;
    count?: number;
  }> {
    const tasks = await this.loadCache();
    const count = tasks.size;

    try {
      const files = await fs.readdir(this.directory);
      for (const file of files) {
        if (file.endsWith(".md")) {
          await fs.unlink(path.join(this.directory, file));
        }
      }
      this.invalidateCache();
      return { success: true, count };
    } catch (error) {
      return {
        success: false,
        error: `Failed to clear tasks: ${error instanceof Error ? error.message : "unknown error"}`,
      };
    }
  }

  async validateDependencies(params: {
    taskId: string;
    dependencies: string[];
  }): Promise<{ valid: boolean; error?: string }> {
    const { taskId, dependencies } = params;
    const tasks = await this.loadCache();

    // Check if all dependencies exist
    const missing = dependencies.filter((dep) => !tasks.has(dep));
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Missing dependencies: ${missing.join(", ")}. Create these tasks first.`,
      };
    }

    // Check for circular dependencies using DFS
    const visited = new Set<string>();
    const path: string[] = [];

    const hasCycle = (id: string): boolean => {
      if (path.includes(id)) {
        return true;
      }
      if (visited.has(id)) {
        return false;
      }

      visited.add(id);
      path.push(id);

      // Get dependencies for this node
      const deps = id === taskId ? dependencies : tasks.get(id)?.dependencies || [];

      for (const dep of deps) {
        if (hasCycle(dep)) {
          return true;
        }
      }

      path.pop();
      return false;
    };

    if (hasCycle(taskId)) {
      return {
        valid: false,
        error: `Circular dependency detected: ${path.join(" -> ")}`,
      };
    }

    return { valid: true };
  }

  private async getDependents(taskId: string): Promise<string[]> {
    const tasks = await this.loadCache();
    const dependents: string[] = [];

    for (const [id, task] of tasks) {
      if (task.dependencies.includes(taskId)) {
        dependents.push(id);
      }
    }

    return dependents;
  }

  private async getIncompleteDependencies(taskId: string): Promise<string[]> {
    const task = await this.getTask(taskId);
    if (!task) return [];

    const tasks = await this.loadCache();
    return task.dependencies.filter((depId) => {
      const dep = tasks.get(depId);
      return dep && dep.status !== "completed";
    });
  }

  async getReadyTasks(): Promise<TaskSummary[]> {
    const tasks = await this.loadCache();
    const ready: TaskSummary[] = [];

    for (const task of tasks.values()) {
      if (task.status !== "pending") continue;

      // Check if all dependencies are completed
      const allDepsComplete = task.dependencies.every((depId) => {
        const dep = tasks.get(depId);
        return dep && dep.status === "completed";
      });

      if (allDepsComplete) {
        ready.push({
          id: task.id,
          title: task.title,
          status: task.status,
          parent: task.parent,
          dependencies: task.dependencies,
          is_parallelizable: task.is_parallelizable,
        });
      }
    }

    return ready;
  }

  async getBlockedTasks(): Promise<TaskSummary[]> {
    const tasks = await this.loadCache();
    const blocked: TaskSummary[] = [];

    for (const task of tasks.values()) {
      if (task.status !== "pending" || task.dependencies.length === 0) continue;

      // Check if any dependency is not completed
      const hasIncompleteDep = task.dependencies.some((depId) => {
        const dep = tasks.get(depId);
        return !dep || dep.status !== "completed";
      });

      if (hasIncompleteDep) {
        blocked.push({
          id: task.id,
          title: task.title,
          status: "blocked",
          parent: task.parent,
          dependencies: task.dependencies,
          is_parallelizable: task.is_parallelizable,
        });
      }
    }

    return blocked;
  }

  formatTaskList(tasks: TaskSummary[]): string {
    if (tasks.length === 0) {
      return "No tasks.";
    }

    const lines: string[] = [
      "| ID | Title | Status | Dependencies | Parallel |",
      "|-----|-------|--------|--------------|----------|",
    ];

    for (const task of tasks) {
      const deps = task.dependencies.length > 0 ? task.dependencies.join(", ") : "-";
      const parallel = task.is_parallelizable ? "yes" : "no";
      lines.push(
        `| ${task.id} | ${task.title} | ${task.status} | ${deps} | ${parallel} |`
      );
    }

    return lines.join("\n");
  }
}
