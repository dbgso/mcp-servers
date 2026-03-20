import { z } from "zod";

// Server configuration
export const ServerConfigSchema = z.object({
  // Working directory for command execution
  cwd: z.string().optional(),
  // Environment variables
  env: z.record(z.string()).optional(),
  // Timeout in milliseconds (default: 30000)
  timeout: z.number().optional(),
});

export type ServerConfig = z.infer<typeof ServerConfigSchema>;

// CLI arguments
export interface CliArgs {
  config?: string;
  cwd?: string;
  timeout?: number;
}

// Execution result
export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  args: string[];
  duration: number;
}
