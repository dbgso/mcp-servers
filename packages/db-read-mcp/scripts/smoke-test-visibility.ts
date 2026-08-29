/**
 * Live check that the field-visibility policy survives contact with a real
 * engine.
 *
 * `selectableFields` is the layer that decides what a caller may see: `expose`
 * passes a value through, `redact` replaces it with `[REDACTED]`, `exclude`
 * keeps the column out of the result entirely. It is well covered by unit
 * tests -- against a fake whose rows are JavaScript objects the test wrote
 * itself.
 *
 * That is the gap. A real driver decides the shape of a row: numerics may
 * arrive as strings, JSON as parsed objects, timestamps as Date instances,
 * absent values as null. The policy has to hold for whatever the engine
 * actually returns, and the only way to know is to ask one.
 *
 * Usage:
 *   pnpm --filter db-read-mcp exec tsx \
 *     scripts/smoke-test-visibility.ts <env-file>
 *
 * Reads the table ci/db/postgres-init.sql seeds.
 */
import { loadEnvFile } from "mcp-shared-secrets";
import { createDatabaseTools } from "mcp-shared-db";
import type { SelectableFieldsMap } from "mcp-shared-db-core";
import type { RdbTableMetadataMap } from "mcp-shared-db-core";
import { postgresStrategy } from "../src/strategies/pg.js";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

const TABLE = "smoke_orders";

const tableMetadata: RdbTableMetadataMap = {
  [TABLE]: {
    tableName: TABLE,
    primaryKey: ["id"],
    fields: {
      id: { type: "number", nullable: false },
      status: { type: "string", nullable: false },
      amount: { type: "number", nullable: false },
      placed_at: { type: "datetime", nullable: false },
      attributes: { type: "json", nullable: false },
    },
  },
};

// One column per verdict, so a single read exercises all three.
const selectableFields: SelectableFieldsMap = {
  [TABLE]: {
    fields: {
      id: { select: "expose" },
      status: { select: "expose" },
      amount: { select: "redact" },
      placed_at: { select: "redact" },
      attributes: { select: "exclude" },
    },
  },
};

interface McpTextResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function parseResult(result: McpTextResult): Record<string, unknown> {
  check(Array.isArray(result.content), "tool result had no content array");
  const first = result.content[0];
  check(first?.type === "text", "tool result was not text");
  check(result.isError !== true, `tool reported an error: ${first.text}`);
  return JSON.parse(first.text) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error("Usage: tsx scripts/smoke-test-visibility.ts <env-file>");
  }
  loadEnvFile(envFile);
  const url = process.env.DBREAD_URL;
  if (!url) throw new Error(`${envFile} does not define DBREAD_URL`);

  const connection = await postgresStrategy.open({ url, tunnel: null, tableMetadata });
  try {
    const [, executeTool] = createDatabaseTools({
      selectableFields,
      tableMetadata,
      getDataSource: async () => connection.dataSource,
    });

    console.log(`[smoke] get_by_pk ${TABLE} id=1 through the visibility layer`);
    const data = parseResult(
      (await executeTool.execute({
        operation: "get_by_pk",
        params: { table: TABLE, pk: 1 },
      })) as McpTextResult,
    );
    const row = (data.row ?? data.rows) as Record<string, unknown> | undefined;
    check(row != null, `no row came back for ${TABLE} id=1`);
    console.log(`[smoke]   row keys: ${Object.keys(row).join(", ")}`);

    // expose — the real value, not a placeholder.
    check("status" in row, "status is exposed but did not come back");
    check(
      row.status === "shipped",
      `status came back as ${JSON.stringify(row.status)}, not the seeded value`,
    );

    // redact — present, but never the stored value. `amount` is the sharper of
    // the two: pg hands numerics back as strings, so a redactor that only
    // recognised numbers would leak it.
    for (const field of ["amount", "placed_at"]) {
      check(field in row, `${field} is redacted, which means present — it is missing`);
      check(
        row[field] === "[REDACTED]",
        `${field} came back as ${JSON.stringify(row[field])} rather than [REDACTED]`,
      );
    }

    // exclude — gone. Not nulled, not redacted: absent.
    check(
      !("attributes" in row),
      "attributes is excluded but appeared in the result, redacted or otherwise",
    );

    console.log("[smoke]   expose passed through, redact masked, exclude absent");

    // The whole point of `exclude` is that the value never leaves the process.
    // Checking the key is gone is not the same as checking the value is, so
    // check the serialised payload the caller would actually receive.
    const serialized = JSON.stringify(data);
    check(
      !serialized.includes("120.00") && !serialized.includes("2026-01-05"),
      "a redacted value survived somewhere in the response payload",
    );
    check(
      !serialized.includes('"region"') && !serialized.includes("east"),
      "an excluded column's contents appeared in the response payload",
    );
    console.log("[smoke]   no redacted or excluded value anywhere in the payload");
  } finally {
    await connection.close();
  }

  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
