/**
 * Live check that a db-read-mcp session refuses to write.
 *
 * The server describes its read-only guarantee as two independent layers: the
 * SQL builder never emits anything but a SELECT, and the session is put in
 * read-only mode as belt-and-braces. The first layer is covered by unit tests
 * and by the absence of a write API. The second was, until this script,
 * asserted in a comment and never executed -- it is a property of the session
 * on a particular engine, so only that engine can confirm it.
 *
 * Usage:
 *   pnpm --filter db-read-mcp exec tsx \
 *     scripts/smoke-test-readonly.ts <env-file>
 *
 * The env file must define DBREAD_URL (`postgres://` or `mysql://`).
 * DBREAD_SMOKE_TABLE names a table for the MySQL write probe; it defaults to
 * `smoke_orders`, the table ci/db/mysql-init.sql seeds.
 *
 * The probes are chosen so that a *failure* of the guard cannot damage the
 * target: Postgres is asked to create a temporary table, and MySQL to run an
 * UPDATE whose WHERE clause matches nothing. If the guard were missing, the
 * temporary table would vanish with the connection and the UPDATE would touch
 * zero rows.
 */
import { loadEnvFile } from "mcp-shared-secrets";
import { createPgClient } from "mcp-shared-db-postgres";
import { createMysqlClient } from "mcp-shared-db-mysql";
import { applyPostgresSessionGuards } from "../src/strategies/pg.js";
import { applyMysqlSessionGuards } from "../src/strategies/mysql.js";

function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`assertion failed: ${message}`);
  }
}

/** Run `write`, and fail unless the engine refuses it. */
async function expectRefused(what: string, write: () => Promise<unknown>): Promise<void> {
  let refusal: string | null = null;
  try {
    await write();
  } catch (err) {
    refusal = err instanceof Error ? err.message : String(err);
  }
  check(
    refusal !== null,
    `${what} was accepted on a session that is supposed to be read-only`,
  );
  console.log(`[smoke]   refused: ${refusal}`);
}

async function smokePostgres(url: string): Promise<void> {
  const client = await createPgClient(url);
  await client.connect();
  client.on("error", (err) => console.error("[smoke] pg client error:", err.message));
  try {
    await applyPostgresSessionGuards({ client, env: process.env });
    console.log("[smoke] session guards applied");

    // Reads still work -- a guard that refuses everything would pass the
    // write check while breaking the server.
    const read = await client.query<{ ok: number }>({ text: "SELECT 1 AS ok" });
    check(read.rows[0]?.ok === 1, "SELECT 1 did not come back from a guarded session");
    console.log("[smoke] SELECT still permitted");

    // Postgres refuses DDL in a read-only transaction, so this needs no
    // existing table and leaves nothing behind either way.
    console.log("[smoke] CREATE TEMP TABLE (expected to be refused)");
    await expectRefused("CREATE TEMP TABLE", () =>
      client.query({ text: "CREATE TEMP TABLE smoke_readonly_probe (x integer)" }),
    );

    // The timeout guard travels with the same call, so check it landed.
    const timeout = await client.query<{ v: string }>({
      text: "SELECT current_setting('statement_timeout') AS v",
    });
    console.log(`[smoke] statement_timeout = ${timeout.rows[0]?.v}`);
    check(
      (timeout.rows[0]?.v ?? "0") !== "0",
      "statement_timeout is unset, so a runaway query has nothing to stop it",
    );
  } finally {
    await client.end();
  }
}

async function smokeMysql(url: string, table: string): Promise<void> {
  const client = await createMysqlClient(url);
  await client.connect();
  client.onError((err) => console.error("[smoke] mysql client error:", err.message));
  try {
    await applyMysqlSessionGuards({ client, env: process.env });
    console.log("[smoke] session guards applied");

    const read = await client.query<{ ok: number }>({ text: "SELECT 1 AS ok" });
    check(Number(read.rows[0]?.ok) === 1, "SELECT 1 did not come back from a guarded session");
    console.log("[smoke] SELECT still permitted");

    // MySQL's read-only transaction only covers non-temporary tables, so the
    // probe has to name a real one. `WHERE 1 = 0` keeps it harmless if the
    // guard is missing: the statement would be accepted and change nothing.
    console.log(`[smoke] UPDATE ${table} ... WHERE 1 = 0 (expected to be refused)`);
    await expectRefused("UPDATE", () =>
      client.query({ text: `UPDATE \`${table}\` SET \`id\` = \`id\` WHERE 1 = 0` }),
    );

    const timeout = await client.query<{ Value: string }>({
      text: "SHOW SESSION VARIABLES LIKE 'max_execution_time'",
    });
    console.log(`[smoke] max_execution_time = ${timeout.rows[0]?.Value}`);
    check(
      Number(timeout.rows[0]?.Value ?? 0) > 0,
      "max_execution_time is unset, so a runaway query has nothing to stop it",
    );
  } finally {
    await client.end();
  }
}

async function main(): Promise<void> {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error("Usage: tsx scripts/smoke-test-readonly.ts <env-file>");
  }
  loadEnvFile(envFile);
  const url = process.env.DBREAD_URL;
  if (!url) {
    throw new Error(`${envFile} does not define DBREAD_URL`);
  }
  const table = process.env.DBREAD_SMOKE_TABLE ?? "smoke_orders";

  if (url.startsWith("postgres://") || url.startsWith("postgresql://")) {
    console.log("[smoke] engine: postgres");
    await smokePostgres(url);
  } else if (url.startsWith("mysql://")) {
    console.log("[smoke] engine: mysql");
    await smokeMysql(url, table);
  } else {
    throw new Error(`DBREAD_URL has no engine this script knows: ${url.split("://")[0]}`);
  }
  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
