import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CoreOperation } from "../types.js";

export class ListTablesOp implements CoreOperation<Record<string, never>> {
  readonly id = "list_tables";
  readonly summary = "List queryable tables with descriptions";
  readonly detail = `Returns every table exposed by the selectable-fields whitelist together with its
description. No DB connection is established — this is computed from in-memory config.

Use this first to discover what tables you can query, then call \`describe_table\`
to inspect a specific table's columns.`;
  readonly category = "Discovery";
  readonly argsSchema = z.object({});
  execute: CoreOperation<Record<string, never>>["execute"] = async ({ ctx }) => {
    const tables = Object.keys(ctx.selectableFields)
      .map((name) => ({
        name,
        description:
          ctx.tableMetadata[name]?.description ?? ctx.selectableFields[name]?.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ count: tables.length, tables });
  };
}

export const listTablesOp = new ListTablesOp();
