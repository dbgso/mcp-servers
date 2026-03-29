/**
 * Workflow Manager
 *
 * Generic manager for workflow instances with caching and persistence.
 * Simplifies workflow usage by handling instance lifecycle.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  createWorkflowInstance,
  loadWorkflowInstance,
} from "./instance.js";
import type {
  WorkflowDefinition,
  WorkflowInstance,
} from "../types/workflow.js";

export interface WorkflowManagerOptions<TState extends string, TContext, TParams> {
  definition: WorkflowDefinition<TState, TContext, TParams>;
  persistDir: string;
  /** Function to create initial context for new instances */
  createInitialContext: (id: string) => TContext;
}

export interface WorkflowStatus<TState extends string, TContext> {
  id: string;
  state: TState;
  visitedStates: TState[];
  context: TContext;
}

export type TriggerResult<TState extends string, TContext> = {
  ok: true;
  from: TState;
  to: TState;
  status: WorkflowStatus<TState, TContext>;
} | {
  ok: false;
  error: string;
  errorType: string;
}

/**
 * Manages workflow instances with caching and persistence
 */
export class WorkflowManager<TState extends string, TContext, TParams> {
  private readonly instances = new Map<string, WorkflowInstance<TState, TContext, TParams>>();
  private readonly definition: WorkflowDefinition<TState, TContext, TParams>;
  private readonly persistDir: string;
  private readonly createInitialContext: (id: string) => TContext;

  constructor(options: WorkflowManagerOptions<TState, TContext, TParams>) {
    this.definition = options.definition;
    this.persistDir = options.persistDir;
    this.createInitialContext = options.createInitialContext;
  }

  /**
   * Get or create a workflow instance
   */
  async getOrCreate(params: {
    id: string;
  }): Promise<WorkflowInstance<TState, TContext, TParams>> {
    const { id } = params;

    // Check cache
    const cached = this.instances.get(id);
    if (cached) {
      return cached;
    }

    // Try to load from file
    const filePath = path.join(this.persistDir, `${id.replace(/__/g, "_")}.json`);
    const loadResult = await loadWorkflowInstance({
      definition: this.definition,
      filePath,
    });

    if (loadResult.ok) {
      this.instances.set(id, loadResult.instance);
      return loadResult.instance;
    }

    // Create new instance
    const instance = createWorkflowInstance({
      definition: this.definition,
      initialContext: this.createInitialContext(id),
      options: {
        instanceId: id,
        persistDir: this.persistDir,
      },
    });

    this.instances.set(id, instance);
    return instance;
  }

  /**
   * Get workflow status
   */
  async getStatus(params: { id: string }): Promise<WorkflowStatus<TState, TContext> | null> {
    const { id } = params;

    try {
      const instance = await this.getOrCreate({ id });
      return {
        id,
        state: instance.state,
        visitedStates: instance.visitedStates,
        context: instance.context,
      };
    } catch {
      return null;
    }
  }

  /**
   * Trigger transition on a workflow
   */
  async trigger(params: {
    id: string;
    triggerParams: TParams;
    approvalToken?: string;
  }): Promise<TriggerResult<TState, TContext>> {
    const { id, triggerParams, approvalToken } = params;

    const instance = await this.getOrCreate({ id });
    const result = await instance.trigger({ params: triggerParams, approvalToken });

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        errorType: result.errorType,
      };
    }

    // Save state
    await instance.save();

    return {
      ok: true,
      from: result.from,
      to: result.to,
      status: {
        id,
        state: instance.state,
        visitedStates: instance.visitedStates,
        context: instance.context,
      },
    };
  }

  /**
   * List all cached workflow instances
   */
  list(): WorkflowStatus<TState, TContext>[] {
    return Array.from(this.instances.entries()).map(([id, instance]) => ({
      id,
      state: instance.state,
      visitedStates: instance.visitedStates,
      context: instance.context,
    }));
  }

  /**
   * Clear a workflow from cache
   */
  clear(params: { id: string }): void {
    this.instances.delete(params.id);
  }

  /**
   * Check if workflow exists in cache
   */
  has(params: { id: string }): boolean {
    return this.instances.has(params.id);
  }

  /**
   * List all workflow instances from persistence directory
   * Unlike list(), this loads from disk and includes all persisted workflows
   */
  async listAll(): Promise<WorkflowStatus<TState, TContext>[]> {
    const results: WorkflowStatus<TState, TContext>[] = [];

    try {
      const files = await fs.readdir(this.persistDir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;

        const filePath = path.join(this.persistDir, file);
        const loadResult = await loadWorkflowInstance({
          definition: this.definition,
          filePath,
        });

        if (loadResult.ok) {
          const id = file.replace(".json", "").replace(/_/g, "__");
          this.instances.set(id, loadResult.instance);
          results.push({
            id,
            state: loadResult.instance.state,
            visitedStates: loadResult.instance.visitedStates,
            context: loadResult.instance.context,
          });
        }
      }
    } catch {
      // Directory doesn't exist or read error - return empty
    }

    return results;
  }

  /**
   * Delete workflow persistence file
   */
  async delete(params: { id: string }): Promise<void> {
    const { id } = params;
    this.instances.delete(id);

    const filePath = path.join(this.persistDir, `${id.replace(/__/g, "_")}.json`);
    try {
      await fs.unlink(filePath);
    } catch {
      // File doesn't exist - ignore
    }
  }
}
