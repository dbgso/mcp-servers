import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  Task,
  TaskStatus,
  TaskSummary,
  TaskOutput,
  Feedback,
  FeedbackDecision,
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

    // Parse task_output from JSON string if present (unescape quotes first)
    const task_output: TaskOutput | null = (() => {
      if (typeof metadata.task_output === "string" && metadata.task_output) {
        try {
          const unescaped = metadata.task_output.replace(/\\"/g, '"');
          return JSON.parse(unescaped);
        } catch {
          return null;
        }
      }
      return null;
    })();

    // Parse parallelizable_units - can be JSON string or already parsed array
    const parallelizable_units: string[] | undefined = (() => {
      if (typeof metadata.parallelizable_units === "string" && metadata.parallelizable_units) {
        try {
          const unescaped = metadata.parallelizable_units.replace(/\\"/g, '"');
          return JSON.parse(unescaped);
        } catch {
          return undefined;
        }
      }
      // If it was already parsed as an array by parseYamlValue
      if (Array.isArray(metadata.parallelizable_units)) {
        return metadata.parallelizable_units as string[];
      }
      return undefined;
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
      task_output,
      is_parallelizable: (metadata.is_parallelizable as boolean) || false,
      parallelizable_units,
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
    const taskOutputJson = JSON.stringify(task.task_output).replace(/"/g, '\\"');
    // Serialize parallelizable_units as JSON string (optional field)
    const parallelizableUnitsJson = task.parallelizable_units
      ? JSON.stringify(task.parallelizable_units).replace(/"/g, '\\"')
      : "";

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
task_output: "${taskOutputJson}"
is_parallelizable: ${task.is_parallelizable}
parallelizable_units: "${parallelizableUnitsJson}"
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
      parallelizable_units: task.parallelizable_units,
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
    parallelizable_units?: string[];
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
      task_output: null,
      is_parallelizable: params.is_parallelizable,
      parallelizable_units: params.parallelizable_units,
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
    parallelizable_units?: string[];
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
      parallelizable_units: params.parallelizable_units ?? task.parallelizable_units,
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
    task_output?: TaskOutput;
  }): Promise<{ success: boolean; error?: string; actualStatus?: TaskStatus }> {
    const { id, status, output, task_output } = params;
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

    const updatedTask: Task = {
      ...task,
      status: actualStatus,
      output: output ?? task.output,
      task_output: task_output ?? task.task_output,
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

    // Check if all child tasks are finished (completed or skipped)
    const childTasks = await this.getChildTasks(id);
    const incompleteChildren = childTasks.filter(
      (child) => !this.isTaskFinished(child.status)
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
          parallelizable_units: task.parallelizable_units,
        });
      }
    }

    return children;
  }

  async deleteTask(params: {
    id: string;
    force?: boolean;
  }): Promise<{ success: boolean; error?: string; deleted?: string[]; pendingDeletion?: string[] }> {
    const { id, force = false } = params;
    const task = await this.getTask(id);
    if (!task) {
      return { success: false, error: `Task "${id}" not found.` };
    }

    // Check if other tasks depend on this
    const dependents = await this.getDependents(id);
    if (dependents.length > 0 && !force) {
      return {
        success: false,
        error: `Cannot delete: other tasks depend on this. Dependents: ${dependents.join(", ")}`,
      };
    }

    // force: true always requires approval via approve tool
    if (force) {
      const allDependents = await this.getAllDependents(id);
      const toDelete = [...allDependents, id];
      await this.createPendingDeletion({ taskId: id, targets: toDelete });
      return { success: true, pendingDeletion: toDelete };
    }

    // Direct delete (no dependents, no force)
    const filePath = this.idToPath(id);
    await fs.unlink(filePath);
    this.invalidateCache();

    return { success: true, deleted: [id] };
  }

  /**
   * Create a pending deletion record that requires approval
   */
  async createPendingDeletion(params: {
    taskId: string;
    targets: string[];
  }): Promise<void> {
    const { taskId, targets } = params;
    const pendingDir = path.join(this.directory, "_pending_deletions");
    await fs.mkdir(pendingDir, { recursive: true });
    const filePath = path.join(pendingDir, `${taskId}.json`);
    await fs.writeFile(filePath, JSON.stringify({ taskId, targets, createdAt: new Date().toISOString() }), "utf-8");
  }

  /**
   * Get pending deletion for a task
   */
  async getPendingDeletion(taskId: string): Promise<{ taskId: string; targets: string[] } | null> {
    const filePath = path.join(this.directory, "_pending_deletions", `${taskId}.json`);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Execute a pending deletion (called after approval)
   */
  async executePendingDeletion(taskId: string): Promise<{ success: boolean; error?: string; deleted?: string[] }> {
    const pending = await this.getPendingDeletion(taskId);
    if (!pending) {
      return { success: false, error: `No pending deletion found for task "${taskId}".` };
    }

    const deleted: string[] = [];
    for (const targetId of pending.targets) {
      const targetPath = this.idToPath(targetId);
      try {
        await fs.unlink(targetPath);
        deleted.push(targetId);
      } catch {
        // Task might already be deleted
      }
    }

    // Remove pending deletion record
    const pendingPath = path.join(this.directory, "_pending_deletions", `${taskId}.json`);
    try {
      await fs.unlink(pendingPath);
    } catch {
      // Ignore
    }

    this.invalidateCache();
    return { success: true, deleted };
  }

  /**
   * Cancel a pending deletion
   */
  async cancelPendingDeletion(taskId: string): Promise<{ success: boolean; error?: string }> {
    const pending = await this.getPendingDeletion(taskId);
    if (!pending) {
      return { success: false, error: `No pending deletion found for task "${taskId}".` };
    }

    const pendingPath = path.join(this.directory, "_pending_deletions", `${taskId}.json`);
    try {
      await fs.unlink(pendingPath);
      return { success: true };
    } catch {
      return { success: false, error: `Failed to cancel pending deletion for task "${taskId}".` };
    }
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

  /**
   * Checks if a task status indicates the task is finished (no longer blocking).
   * Both "completed" and "skipped" are considered finished states.
   */
  private isTaskFinished(status: TaskStatus): boolean {
    return status === "completed" || status === "skipped";
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

  /**
   * Get child task IDs (tasks where parent equals this taskId)
   */
  private async getChildren(taskId: string): Promise<string[]> {
    const tasks = await this.loadCache();
    const children: string[] = [];

    for (const [id, task] of tasks) {
      if (task.parent === taskId) {
        children.push(id);
      }
    }

    return children;
  }

  /**
   * Get all tasks that depend on the given task, recursively.
   * Includes both:
   * - Tasks that have this task in their `dependencies` array
   * - Tasks that have this task as their `parent`
   * Returns tasks in order suitable for deletion (leaf nodes first).
   */
  async getAllDependents(taskId: string): Promise<string[]> {
    const visited = new Set<string>();
    const result: string[] = [];

    const collectDependents = async (id: string): Promise<void> => {
      // Get tasks that depend on this task via dependencies field
      const dependents = await this.getDependents(id);
      // Get child tasks via parent field
      const children = await this.getChildren(id);
      // Combine both
      const allRelated = [...new Set([...dependents, ...children])];

      for (const relatedId of allRelated) {
        if (!visited.has(relatedId)) {
          visited.add(relatedId);
          await collectDependents(relatedId);
          result.push(relatedId);
        }
      }
    };

    await collectDependents(taskId);
    return result;
  }

  private async getIncompleteDependencies(taskId: string): Promise<string[]> {
    const task = await this.getTask(taskId);
    if (!task) return [];

    const tasks = await this.loadCache();
    return task.dependencies.filter((depId) => {
      const dep = tasks.get(depId);
      return dep && !this.isTaskFinished(dep.status);
    });
  }

  async getReadyTasks(): Promise<TaskSummary[]> {
    const tasks = await this.loadCache();
    const ready: TaskSummary[] = [];

    for (const task of tasks.values()) {
      if (task.status !== "pending") continue;

      // Check if all dependencies are finished (completed or skipped)
      const allDepsComplete = task.dependencies.every((depId) => {
        const dep = tasks.get(depId);
        return dep && this.isTaskFinished(dep.status);
      });

      if (allDepsComplete) {
        ready.push({
          id: task.id,
          title: task.title,
          status: task.status,
          parent: task.parent,
          dependencies: task.dependencies,
          is_parallelizable: task.is_parallelizable,
          parallelizable_units: task.parallelizable_units,
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

      // Check if any dependency is not finished (not completed and not skipped)
      const hasIncompleteDep = task.dependencies.some((depId) => {
        const dep = tasks.get(depId);
        return !dep || !this.isTaskFinished(dep.status);
      });

      if (hasIncompleteDep) {
        blocked.push({
          id: task.id,
          title: task.title,
          status: "blocked",
          parent: task.parent,
          dependencies: task.dependencies,
          is_parallelizable: task.is_parallelizable,
          parallelizable_units: task.parallelizable_units,
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
