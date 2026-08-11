import { TypeScriptHandler } from "./typescript.js";
import type { Config } from "../config.js";

let handler: TypeScriptHandler | null = null;

export function initHandler(config?: Config): void {
  handler = new TypeScriptHandler(config);
}

export function getHandler(filePath: string): TypeScriptHandler | undefined {
  if (!handler) {
    handler = new TypeScriptHandler();
  }
  if (handler.canHandle(filePath)) {
    return handler;
  }
  return undefined;
}

export function getSupportedExtensions(): string[] {
  if (!handler) {
    handler = new TypeScriptHandler();
  }
  return handler.extensions;
}

export { TypeScriptHandler };
