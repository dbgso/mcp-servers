import { TypeScriptHandler } from "./typescript.js";

const handler = new TypeScriptHandler();

export function getHandler(filePath: string): TypeScriptHandler | undefined {
  if (handler.canHandle(filePath)) {
    return handler;
  }
  return undefined;
}

export function getSupportedExtensions(): string[] {
  return handler.extensions;
}

export { TypeScriptHandler };
