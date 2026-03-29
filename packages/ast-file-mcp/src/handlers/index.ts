import { MarkdownHandler } from "./markdown.js";
import { AsciidocHandler } from "./asciidoc.js";

const markdownHandler = new MarkdownHandler();
const asciidocHandler = new AsciidocHandler();

const handlers = [markdownHandler, asciidocHandler] as const;

export function getHandler(filePath: string): MarkdownHandler | AsciidocHandler | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  return handlers.find((h) => h.extensions.includes(ext));
}

export function getSupportedExtensions(): string[] {
  return handlers.flatMap((h) => h.extensions);
}

export { MarkdownHandler, AsciidocHandler };
