import type {
  PlanActionHandler,
  PlanActionParams,
  PlanActionContext,
  ToolResult,
  TaskSummary,
} from "../../../types/index.js";

export class GraphHandler implements PlanActionHandler {
  async execute(params: {
    actionParams: PlanActionParams;
    context: PlanActionContext;
  }): Promise<ToolResult> {
    const { planReader } = params.context;
    const tasks: TaskSummary[] = await planReader.listTasks();

    if (tasks.length === 0) {
      return {
        content: [
          {
            type: "text" as const,
            text: "No tasks to graph.",
          },
        ],
      };
    }

    const blockedTasks = await planReader.getBlockedTasks();
    const blockedIds = new Set(blockedTasks.map((t) => t.id));

    // Build Mermaid flowchart
    let mermaid = "```mermaid\nflowchart TD\n";

    // Define nodes with status styling
    for (const task of tasks) {
      const status = blockedIds.has(task.id) ? "blocked" : task.status;
      const icon = this.getStatusIcon(status);
      const label = `${task.title} ${icon}`;
      const nodeId = this.sanitizeId(task.id);

      // Use different shapes based on parallelizable
      if (task.is_parallelizable) {
        mermaid += `  ${nodeId}([${label}])\n`;
      } else {
        mermaid += `  ${nodeId}[${label}]\n`;
      }
    }

    mermaid += "\n";

    // Define edges (dependencies)
    for (const task of tasks) {
      const nodeId = this.sanitizeId(task.id);
      for (const dep of task.dependencies) {
        const depId = this.sanitizeId(dep);
        mermaid += `  ${depId} --> ${nodeId}\n`;
      }
    }

    mermaid += "\n";

    // Add styling
    mermaid += "  %% Styling\n";
    for (const task of tasks) {
      const status = blockedIds.has(task.id) ? "blocked" : task.status;
      const style = this.getStatusStyle(status);
      const nodeId = this.sanitizeId(task.id);
      mermaid += `  style ${nodeId} ${style}\n`;
    }

    mermaid += "```";

    // Add legend
    let output = "# Task Graph\n\n";
    output += mermaid;
    output += "\n\n## Legend\n";
    output += "- ✓ completed\n";
    output += "- ⏳ pending_review\n";
    output += "- ● in_progress\n";
    output += "- ○ pending/ready\n";
    output += "- ◇ blocked\n";
    output += "- ⊘ skipped\n";
    output += "- `[ ]` sequential\n";
    output += "- `([ ])` parallelizable\n";

    return {
      content: [{ type: "text" as const, text: output }],
    };
  }

  private sanitizeId(id: string): string {
    // Mermaid IDs can't have hyphens in some contexts, replace with underscore
    return id.replace(/-/g, "_");
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✓";
      case "in_progress":
        return "●";
      case "pending_review":
        return "⏳";
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
      case "in_progress":
        return "fill:#87CEEB,stroke:#4169E1";
      case "pending_review":
        return "fill:#DDA0DD,stroke:#8B008B";
      case "blocked":
        return "fill:#FFB6C1,stroke:#DC143C";
      case "skipped":
        return "fill:#D3D3D3,stroke:#808080";
      default:
        return "fill:#FFFACD,stroke:#DAA520";
    }
  }
}
