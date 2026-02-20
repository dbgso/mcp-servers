import type { FileHandler, AstReadResult } from "../types/index.js";

export abstract class BaseHandler implements FileHandler {
  abstract readonly extensions: string[];
  abstract readonly fileType: string;

  abstract read(filePath: string): Promise<AstReadResult>;

  write?(filePath: string, ast: unknown): Promise<void>;

  canHandle(filePath: string): boolean {
    const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
    return this.extensions.includes(ext);
  }
}
