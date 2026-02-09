export interface ToolResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface ActionHandler<TParams, TContext> {
  execute(params: {
    actionParams: TParams;
    context: TContext;
  }): Promise<ToolResult>;
}

export interface GitActionParams {
  repository?: string;
  branch?: string;
  path?: string;
  pattern?: string;
  ref?: string;
  file?: string;
  line?: number;
  limit?: number;
  format?: string;
  args?: string;
}

export interface GitContext {
  executor: GitExecutor;
  repoManager: RepositoryManager;
}

export type GitActionHandler = ActionHandler<GitActionParams, GitContext>;

export interface GitExecutor {
  execute(params: {
    cwd: string;
    args: string[];
  }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
}

export interface RepositoryInfo {
  name: string;
  url: string;
  localPath: string;
  worktrees: WorktreeInfo[];
}

export interface WorktreeInfo {
  branch: string;
  path: string;
}

export interface RepositoryManager {
  getBaseDir(): string;
  clone(params: { url: string; name?: string }): Promise<{ success: boolean; path: string; error?: string }>;
  getRepoPath(params: { repository: string; branch?: string }): Promise<{ success: boolean; path: string; error?: string }>;
  addWorktree(params: { repository: string; branch: string }): Promise<{ success: boolean; path: string; error?: string }>;
  listRepositories(): Promise<RepositoryInfo[]>;
  removeRepository(params: { repository: string }): Promise<{ success: boolean; error?: string }>;
  removeWorktree(params: { repository: string; branch: string }): Promise<{ success: boolean; error?: string }>;
}

export interface ReminderConfig {
  remindMcp?: boolean;
  remindOrg?: string;
  remindTask?: string;
  remindTaskTtl?: number;
}
