import { readFile } from "node:fs/promises";
import Asciidoctor from "@asciidoctor/core";
import { BaseHandler } from "./base.js";
import type { AstReadResult, AsciidocDocument, AsciidocBlock } from "../types/index.js";

const asciidoctor = Asciidoctor();

export class AsciidocHandler extends BaseHandler {
  readonly extensions = ["adoc", "asciidoc", "asc"];
  readonly fileType = "asciidoc";

  async read(filePath: string): Promise<AstReadResult> {
    const content = await readFile(filePath, "utf-8");
    const doc = asciidoctor.load(content);

    const ast: AsciidocDocument = {
      type: "asciidoc",
      title: doc.getTitle() as string | undefined,
      blocks: this.convertBlocks(doc.getBlocks()),
    };

    return {
      filePath,
      fileType: "asciidoc",
      ast,
    };
  }

  private convertBlocks(blocks: unknown[]): AsciidocBlock[] {
    return blocks.map((block: unknown) => {
      const b = block as {
        getContext(): string;
        getContent?(): string;
        getLines?(): string[];
        getBlocks?(): unknown[];
      };

      const result: AsciidocBlock = {
        context: b.getContext(),
      };

      if (typeof b.getContent === "function") {
        result.content = b.getContent();
      }

      if (typeof b.getLines === "function") {
        result.lines = b.getLines();
      }

      if (typeof b.getBlocks === "function") {
        const nestedBlocks = b.getBlocks();
        if (nestedBlocks && nestedBlocks.length > 0) {
          result.blocks = this.convertBlocks(nestedBlocks);
        }
      }

      return result;
    });
  }

  // Note: asciidoctor.js does not support serialization back to AsciiDoc
  // write is intentionally not implemented
}
