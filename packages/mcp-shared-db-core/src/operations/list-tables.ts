import { z } from "zod";
import { jsonResponse } from "mcp-shared";
import type { CoreOperation } from "../types.js";

export const listTablesOp: CoreOperation<Record<string, never>> = {
  id: "list_tables",
  summary: "List queryable tables with descriptions",
  detail: `Returns every table exposed by the selectable-fields whitelist together with its
description. No DB connection is established — this is computed from in-memory config.

Use this first to discover what tables you can query, then call \`describe_table\`
to inspect a specific table's columns.`,
  category: "Discovery",
  argsSchema: z.object({}),
  execute: async ({ ctx }) => {
    const tables = Object.keys(ctx.selectableFields)
      .map((name) => ({
        name,
        description:
          ctx.tableMetadata[name]?.description ?? ctx.selectableFields[name]?.description,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return jsonResponse({ count: tables.length, tables });
  },
};
