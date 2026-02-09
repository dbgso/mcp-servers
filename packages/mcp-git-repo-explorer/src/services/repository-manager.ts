import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type {
  GitExecutor,
  RepositoryInfo,
  RepositoryManager,
  WorktreeInfo,
} from "../types/index.js";

export class DefaultRepositoryManager implements RepositoryManager {
  private baseDir: string;
  private executor: GitExecutor;

  constructor(params: { baseDir: string; executor: GitExecutor }) {
    this.baseDir = params.baseDir;
    this.executor = params.executor;
  }

  getBaseDir(): string {
    return this.baseDir;
  }

  private getRepoDir(repository: string): string {
    return join(this.baseDir, repository);
  }

  private getWorktreeDir(repository: string, branch: string): string {
    const safeBranch = branch.replace(/\//g, "__");
    return join(this.baseDir, repository, ".worktrees", safeBranch);
  }

  async clone(params: {
    url: string;
    name?: string;
  }): Promise<{ success: boolean; path: string; error?: string }> {
    const { url, name } = params;

    const repoName = name ?? this.extractRepoName(url);
    const repoPath = this.getRepoDir(repoName);

    try {
      await mkdir(this.baseDir, { recursive: true });

      const exists = await this.directoryExists(repoPath);
      if (exists) {
        return {
          success: true,
          path: repoPath,
        };
      }

      const result = await this.executor.execute({
        cwd: this.baseDir,
        args: ["clone", "--bare", url, repoName],
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          path: "",
          error: result.stderr || "Clone failed",
        };
      }

      return {
        success: true,
        path: repoPath,
      };
    } catch (err) {
      return {
        success: false,
        path: "",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async getRepoPath(params: {
    repository: string;
    branch?: string;
  }): Promise<{ success: boolean; path: string; error?: string }> {
    const { repository, branch } = params;

    const repoPath = this.getRepoDir(repository);
    const exists = await this.directoryExists(repoPath);

    if (!exists) {
      return {
        success: false,
        path: "",
        error: `Repository '${repository}' not found. Clone it first.`,
      };
    }

    if (!branch) {
      const defaultBranch = await this.getDefaultBranch(repoPath);
      if (!defaultBranch) {
        return {
          success: false,
          path: "",
          error: "Could not determine default branch",
        };
      }
      return this.getRepoPath({ repository, branch: defaultBranch });
    }

    const worktreePath = this.getWorktreeDir(repository, branch);
    const worktreeExists = await this.directoryExists(worktreePath);

    if (worktreeExists) {
      return {
        success: true,
        path: worktreePath,
      };
    }

    return this.addWorktree({ repository, branch });
  }

  async addWorktree(params: {
    repository: string;
    branch: string;
  }): Promise<{ success: boolean; path: string; error?: string }> {
    const { repository, branch } = params;

    const repoPath = this.getRepoDir(repository);
    const worktreePath = this.getWorktreeDir(repository, branch);

    try {
      await mkdir(join(repoPath, ".worktrees"), { recursive: true });

      const worktreeExists = await this.directoryExists(worktreePath);
      if (worktreeExists) {
        return {
          success: true,
          path: worktreePath,
        };
      }

      const branchExists = await this.branchExists(repoPath, branch);

      let result;
      if (branchExists) {
        result = await this.executor.execute({
          cwd: repoPath,
          args: ["worktree", "add", worktreePath, branch],
        });
      } else {
        result = await this.executor.execute({
          cwd: repoPath,
          args: ["worktree", "add", "-b", branch, worktreePath, "HEAD"],
        });
      }

      if (result.exitCode !== 0) {
        return {
          success: false,
          path: "",
          error: result.stderr || "Failed to add worktree",
        };
      }

      return {
        success: true,
        path: worktreePath,
      };
    } catch (err) {
      return {
        success: false,
        path: "",
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async listRepositories(): Promise<RepositoryInfo[]> {
    try {
      const exists = await this.directoryExists(this.baseDir);
      if (!exists) {
        return [];
      }

      const entries = await readdir(this.baseDir, { withFileTypes: true });
      const repos: RepositoryInfo[] = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const repoPath = join(this.baseDir, entry.name);
        const isGitRepo = await this.isGitRepository(repoPath);

        if (isGitRepo) {
          const url = await this.getRemoteUrl(repoPath);
          const worktrees = await this.listWorktrees(repoPath);

          repos.push({
            name: entry.name,
            url,
            localPath: repoPath,
            worktrees,
          });
        }
      }

      return repos;
    } catch {
      return [];
    }
  }

  async removeRepository(params: {
    repository: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { repository } = params;
    const repoPath = this.getRepoDir(repository);

    try {
      const exists = await this.directoryExists(repoPath);
      if (!exists) {
        return {
          success: false,
          error: `Repository '${repository}' not found`,
        };
      }

      await rm(repoPath, { recursive: true, force: true });

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  async removeWorktree(params: {
    repository: string;
    branch: string;
  }): Promise<{ success: boolean; error?: string }> {
    const { repository, branch } = params;
    const repoPath = this.getRepoDir(repository);
    const worktreePath = this.getWorktreeDir(repository, branch);

    try {
      const result = await this.executor.execute({
        cwd: repoPath,
        args: ["worktree", "remove", worktreePath, "--force"],
      });

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: result.stderr || "Failed to remove worktree",
        };
      }

      return { success: true };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : "Unknown error",
      };
    }
  }

  private async directoryExists(path: string): Promise<boolean> {
    try {
      const s = await stat(path);
      return s.isDirectory();
    } catch {
      return false;
    }
  }

  private async isGitRepository(path: string): Promise<boolean> {
    const result = await this.executor.execute({
      cwd: path,
      args: ["rev-parse", "--git-dir"],
    });
    return result.exitCode === 0;
  }

  private async branchExists(repoPath: string, branch: string): Promise<boolean> {
    const result = await this.executor.execute({
      cwd: repoPath,
      args: ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    });
    return result.exitCode === 0;
  }

  private async getDefaultBranch(repoPath: string): Promise<string | null> {
    const result = await this.executor.execute({
      cwd: repoPath,
      args: ["symbolic-ref", "--short", "HEAD"],
    });

    if (result.exitCode === 0 && result.stdout) {
      return result.stdout.trim();
    }

    const refResult = await this.executor.execute({
      cwd: repoPath,
      args: ["config", "--get", "init.defaultBranch"],
    });

    if (refResult.exitCode === 0 && refResult.stdout) {
      return refResult.stdout.trim();
    }

    for (const branch of ["main", "master"]) {
      const exists = await this.branchExists(repoPath, branch);
      if (exists) {
        return branch;
      }
    }

    return null;
  }

  private async getRemoteUrl(repoPath: string): Promise<string> {
    const result = await this.executor.execute({
      cwd: repoPath,
      args: ["config", "--get", "remote.origin.url"],
    });
    return result.stdout || "";
  }

  private async listWorktrees(repoPath: string): Promise<WorktreeInfo[]> {
    const result = await this.executor.execute({
      cwd: repoPath,
      args: ["worktree", "list", "--porcelain"],
    });

    if (result.exitCode !== 0) {
      return [];
    }

    const worktrees: WorktreeInfo[] = [];
    const blocks = result.stdout.split("\n\n").filter(Boolean);

    for (const block of blocks) {
      const lines = block.split("\n");
      let path = "";
      let branch = "";

      for (const line of lines) {
        if (line.startsWith("worktree ")) {
          path = line.substring(9);
        } else if (line.startsWith("branch refs/heads/")) {
          branch = line.substring(18);
        }
      }

      if (path && branch && path !== repoPath) {
        worktrees.push({ branch, path });
      }
    }

    return worktrees;
  }

  private extractRepoName(url: string): string {
    const match = url.match(/\/([^/]+?)(\.git)?$/);
    return match ? match[1] : "repo";
  }
}
