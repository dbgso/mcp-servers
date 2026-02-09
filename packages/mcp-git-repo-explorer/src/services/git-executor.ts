import { spawn } from "node:child_process";
import type { GitExecutor } from "../types/index.js";

export class DefaultGitExecutor implements GitExecutor {
  async execute(params: {
    cwd: string;
    args: string[];
  }): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { cwd, args } = params;

    return new Promise((resolve) => {
      const proc = spawn("git", args, {
        cwd,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
      });

      let stdout = "";
      let stderr = "";

      proc.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      proc.stderr.on("data", (data) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        resolve({
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: code ?? 1,
        });
      });

      proc.on("error", (err) => {
        resolve({
          stdout: "",
          stderr: err.message,
          exitCode: 1,
        });
      });
    });
  }
}
