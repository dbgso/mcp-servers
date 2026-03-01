import { z } from "zod";
import { jsonResponse, errorResponse, getErrorMessage } from "mcp-shared";
import { BaseToolHandler } from "mcp-shared";
import type { ToolResponse } from "../types.js";
import { Project, Node, SyntaxKind } from "ts-morph";
import type { CallExpression, SourceFile } from "ts-morph";
import type { CallBlock, FindBlocksResult } from "../../types/index.js";
import { glob } from "glob";

const FindBlocksSchema = z.object({
  file_path: z
    .union([z.string(), z.array(z.string())])
    .describe("File path(s) or glob pattern to search"),
  block_types: z
    .array(z.string())
    .optional()
    .default(["describe", "it", "test", "beforeAll", "afterAll", "beforeEach", "afterEach"])
    .describe("Block types to find (default: describe, it, test, before/after hooks)"),
  name_pattern: z
    .string()
    .optional()
    .describe("Regex pattern to filter block names"),
  include_nested: z
    .boolean()
    .optional()
    .default(true)
    .describe("Include nested blocks in tree structure (default: true)"),
  max_depth: z
    .number()
    .optional()
    .default(10)
    .describe("Maximum nesting depth (default: 10)"),
  include_source: z
    .boolean()
    .optional()
    .default(false)
    .describe("Include block source code (default: false)"),
});

type FindBlocksArgs = z.infer<typeof FindBlocksSchema>;

export class FindBlocksHandler extends BaseToolHandler<FindBlocksArgs> {
  readonly name = "ts_find_blocks";
  readonly description =
    "Find call expression blocks (describe, it, test, etc.) with location and nesting info. Returns start/end lines for each block.";
  readonly schema = FindBlocksSchema;

  readonly inputSchema = {
    type: "object" as const,
    properties: {
      file_path: {
        oneOf: [
          { type: "string" },
          { type: "array", items: { type: "string" } },
        ],
        description: "File path(s) or glob pattern to search",
      },
      block_types: {
        type: "array",
        items: { type: "string" },
        description: "Block types to find (default: describe, it, test, before/after hooks)",
      },
      name_pattern: {
        type: "string",
        description: "Regex pattern to filter block names",
      },
      include_nested: {
        type: "boolean",
        description: "Include nested blocks in tree structure (default: true)",
      },
      max_depth: {
        type: "number",
        description: "Maximum nesting depth (default: 10)",
      },
      include_source: {
        type: "boolean",
        description: "Include block source code (default: false)",
      },
    },
    required: ["file_path"],
  };

  protected async doExecute(args: FindBlocksArgs): Promise<ToolResponse> {
    const { file_path, block_types, name_pattern, include_nested, max_depth, include_source } = args;

    try {
      // Resolve file paths
      const filePaths = await this.resolveFilePaths(file_path);

      if (filePaths.length === 0) {
        return errorResponse("No files found matching the pattern");
      }

      const project = new Project({ skipAddingFilesFromTsConfig: true });
      const allBlocks: CallBlock[] = [];
      const nameRegex = name_pattern ? new RegExp(name_pattern) : null;

      for (const filePath of filePaths) {
        const sourceFile = project.addSourceFileAtPath(filePath);
        // Collect ALL blocks first (no name filter during collection)
        const fileBlocks = this.findBlocksInFile({
          sourceFile,
          filePath,
          blockTypes: block_types,
          nameRegex: null, // Don't filter by name here
          maxDepth: max_depth,
          includeSource: include_source,
        });
        allBlocks.push(...fileBlocks);
        project.removeSourceFile(sourceFile);
      }

      // Apply name filter and build result structure
      const matchingBlocks = nameRegex
        ? allBlocks.filter(b => nameRegex.test(b.name))
        : allBlocks;

      let blocks: CallBlock[];

      if (include_nested) {
        if (nameRegex) {
          // Build tree with matching blocks as roots, including their children
          blocks = this.buildTreeForMatchingBlocks({ allBlocks: allBlocks, matchingBlocks: matchingBlocks });
        } else {
          // Standard tree from all blocks
          blocks = this.buildBlockTree(allBlocks);
        }
      } else {
        if (nameRegex) {
          // Return flat list of matching blocks (without children)
          blocks = matchingBlocks.map(b => ({ ...b, children: [] }));
        } else {
          // Only top-level blocks
          blocks = allBlocks.filter(b => b.depth === 0);
        }
      }

      const result: FindBlocksResult = {
        blocks,
        totalCount: matchingBlocks.length,
        filesSearched: filePaths.length,
        byType: this.groupByType(matchingBlocks),
      };

      return jsonResponse(result);
    } catch (error) {
      return errorResponse(
        `ts_find_blocks failed: ${getErrorMessage(error)}`
      );
    }
  }

  private async resolveFilePaths(input: string | string[]): Promise<string[]> {
    const patterns = Array.isArray(input) ? input : [input];
    const allPaths: string[] = [];

    for (const pattern of patterns) {
      if (pattern.includes("*")) {
        const matches = await glob(pattern, { absolute: true });
        allPaths.push(...matches);
      } else {
        allPaths.push(pattern);
      }
    }

    return [...new Set(allPaths)].filter(p =>
      p.endsWith(".ts") || p.endsWith(".tsx") || p.endsWith(".mts") || p.endsWith(".cts")
    );
  }

  private findBlocksInFile(params: {
    sourceFile: SourceFile;
    filePath: string;
    blockTypes: string[];
    nameRegex: RegExp | null;
    maxDepth: number;
    includeSource: boolean;
  }): CallBlock[] {
    const { sourceFile, filePath, blockTypes, nameRegex, maxDepth, includeSource } = params;
    const blocks: CallBlock[] = [];
    const blockTypeSet = new Set(blockTypes);

    // Find all call expressions
    const callExpressions = sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression);

    for (const call of callExpressions) {
      const callee = call.getExpression();

      // Get callee name (handle both Identifier and PropertyAccessExpression like test.each)
      let calleeName: string | null = null;
      if (Node.isIdentifier(callee)) {
        calleeName = callee.getText();
      } else if (Node.isPropertyAccessExpression(callee)) {
        // For test.each, test.skip, etc. - get the base name
        const base = callee.getExpression();
        if (Node.isIdentifier(base)) {
          calleeName = base.getText();
        }
      }

      if (!calleeName || !blockTypeSet.has(calleeName)) continue;

      // Extract block name from first argument
      const args = call.getArguments();
      const nameArg = args[0];
      let blockName: string;

      if (!nameArg) {
        blockName = "(no name)";
      } else if (Node.isStringLiteral(nameArg)) {
        blockName = nameArg.getLiteralText();
      } else if (Node.isTemplateExpression(nameArg) || Node.isNoSubstitutionTemplateLiteral(nameArg)) {
        blockName = nameArg.getText().replace(/^`|`$/g, "");
      } else {
        blockName = nameArg.getText();
      }

      // Apply name filter
      if (nameRegex && !nameRegex.test(blockName)) continue;

      // Calculate depth
      const depth = this.calculateBlockDepth({ call: call, blockTypes: blockTypeSet });
      if (depth > maxDepth) continue;

      // Get parent block name
      const parentName = this.getParentBlockName({ call: call, blockTypes: blockTypeSet });

      const block: CallBlock = {
        type: calleeName,
        name: blockName,
        filePath,
        startLine: call.getStartLineNumber(),
        endLine: call.getEndLineNumber(),
        column: call.getStart() - sourceFile.compilerNode.getLineStarts()[call.getStartLineNumber() - 1] + 1,
        depth,
        parent: parentName,
        children: [],
        source: includeSource ? call.getText() : undefined,
      };

      blocks.push(block);
    }

    return blocks;
  }

  private calculateBlockDepth({ call, blockTypes }: { call: CallExpression; blockTypes: Set<string> }): number {
    let depth = 0;
    let parent = call.getParent();

    while (parent) {
      if (Node.isCallExpression(parent)) {
        const callee = parent.getExpression();
        if (Node.isIdentifier(callee) && blockTypes.has(callee.getText())) {
          depth++;
        }
      }
      parent = parent.getParent();
    }

    return depth;
  }

  private getParentBlockName({ call, blockTypes }: { call: CallExpression; blockTypes: Set<string> }): string | undefined {
    let parent = call.getParent();

    while (parent) {
      if (Node.isCallExpression(parent)) {
        const callee = parent.getExpression();
        if (Node.isIdentifier(callee) && blockTypes.has(callee.getText())) {
          const args = parent.getArguments();
          const nameArg = args[0];
          if (nameArg && Node.isStringLiteral(nameArg)) {
            return nameArg.getLiteralText();
          }
          return nameArg?.getText();
        }
      }
      parent = parent.getParent();
    }

    return undefined;
  }

  private buildBlockTree(blocks: CallBlock[]): CallBlock[] {
    // Group by file and sort by start line (descending to process children first)
    const byFile = new Map<string, CallBlock[]>();
    for (const block of blocks) {
      const list = byFile.get(block.filePath) ?? [];
      list.push(block);
      byFile.set(block.filePath, list);
    }

    const rootBlocks: CallBlock[] = [];

    for (const [, fileBlocks] of byFile) {
      // Sort by start line
      fileBlocks.sort((a, b) => a.startLine - b.startLine);

      // Build tree using parent relationship
      const blockMap = new Map<string, CallBlock>();
      const roots: CallBlock[] = [];

      for (const block of fileBlocks) {
        // Create key from file:line for uniqueness
        const key = `${block.filePath}:${block.startLine}:${block.name}`;
        blockMap.set(key, block);

        if (block.depth === 0 || !block.parent) {
          roots.push(block);
        }
      }

      // Assign children based on line ranges
      for (const block of fileBlocks) {
        if (block.depth > 0) {
          // Find parent by looking for the nearest containing block
          for (const potentialParent of fileBlocks) {
            if (
              potentialParent !== block &&
              potentialParent.startLine < block.startLine &&
              potentialParent.endLine > block.endLine &&
              potentialParent.depth === block.depth - 1
            ) {
              potentialParent.children.push(block);
              break;
            }
          }
        }
      }

      rootBlocks.push(...roots);
    }

    return rootBlocks;
  }

  /**
   * Build tree structure where matching blocks become roots with their children attached.
   */
  private buildTreeForMatchingBlocks({ allBlocks, matchingBlocks }: { allBlocks: CallBlock[]; matchingBlocks: CallBlock[] }): CallBlock[] {
    // Group all blocks by file
    const byFile = new Map<string, CallBlock[]>();
    for (const block of allBlocks) {
      const list = byFile.get(block.filePath) ?? [];
      list.push(block);
      byFile.set(block.filePath, list);
    }

    // For each matching block, find and attach children
    const result: CallBlock[] = [];
    const matchingSet = new Set(matchingBlocks);

    for (const matchBlock of matchingBlocks) {
      const fileBlocks = byFile.get(matchBlock.filePath) ?? [];

      // Clone the matching block to avoid mutations
      const rootBlock: CallBlock = { ...matchBlock, children: [] };

      // Find direct children (blocks contained within this block's range)
      this.attachChildren({ parent: rootBlock, allFileBlocks: fileBlocks, matchingSet: matchingSet });

      result.push(rootBlock);
    }

    return result;
  }

  /**
   * Recursively attach children to a block based on line ranges.
   */
  private attachChildren({ parent, allFileBlocks, matchingSet }: { parent: CallBlock; allFileBlocks: CallBlock[]; matchingSet: Set<CallBlock> }): void {
    for (const block of allFileBlocks) {
      // Skip if same block or if it's a matching block (already a root)
      if (block === parent || (matchingSet.has(block) && block !== parent)) continue;

      // Check if block is a direct child (contained within parent, one depth level deeper)
      if (
        block.startLine > parent.startLine &&
        block.endLine < parent.endLine &&
        block.depth === parent.depth + 1
      ) {
        const childBlock: CallBlock = { ...block, children: [] };
        parent.children.push(childBlock);

        // Recursively attach children to this child
        this.attachChildren({ parent: childBlock, allFileBlocks: allFileBlocks, matchingSet: matchingSet });
      }
    }

    // Sort children by start line
    parent.children.sort((a, b) => a.startLine - b.startLine);
  }

  private groupByType(blocks: CallBlock[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const block of blocks) {
      counts[block.type] = (counts[block.type] ?? 0) + 1;
    }
    return counts;
  }
}
