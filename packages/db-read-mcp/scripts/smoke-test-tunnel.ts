/**
 * Live check that db-read-mcp can reach a database through an SSH bastion.
 *
 * `resolveTunneledUrl` spawns a real `ssh -L`, waits for the forwarded port to
 * accept, rewrites the URL to point at it, and tears the child down on close.
 * Every one of those steps was covered only by unit tests with an injected
 * `spawnFn` -- which verifies the argv and the bookkeeping, and cannot verify
 * that a real ssh accepts those arguments or that traffic actually crosses.
 *
 * Usage:
 *   pnpm --filter db-read-mcp exec tsx \
 *     scripts/smoke-test-tunnel.ts <env-file>
 *
 * Unlike the introspection smoke tests this one is not schema-agnostic: it
 * reads from the table ci/db/postgres-init.sql seeds, because the point is the
 * transport rather than the query.
 */
import * as path from "node:path";
import { loadEnvFile } from "mcp-shared-secrets";
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
    },
  },
};

async function main(): Promise<void> {
  const envFile = process.argv[2];
  if (!envFile) {
    throw new Error("Usage: tsx scripts/smoke-test-tunnel.ts <env-file>");
  }
  loadEnvFile(envFile);

  const url = process.env.DBREAD_URL;
  const host = process.env.DBREAD_BASTION_HOST;
  const identityFile = process.env.DBREAD_BASTION_KEY;
  if (!url || !host || !identityFile) {
    throw new Error(
      `${envFile} must define DBREAD_URL, DBREAD_BASTION_HOST and DBREAD_BASTION_KEY`,
    );
  }
  // Resolved against the env file rather than the process cwd: this runs
  // through `pnpm --filter`, so the cwd is the package directory, and a path
  // written relative to the repository root would miss.
  const identityPath = path.isAbsolute(identityFile)
    ? identityFile
    : path.resolve(path.dirname(path.resolve(envFile)), identityFile);

  // The bastion listens on a non-standard port, and its host key is new on
  // every run because the container is new on every run.
  const extraSshArgs = (process.env.DBREAD_BASTION_SSH_ARGS ?? "")
    .split(" ")
    .filter((a) => a.length > 0);

  // The URL names the database as the *bastion* sees it -- a hostname on the
  // container network that does not resolve here. If the tunnel is not
  // actually carrying the connection, this cannot accidentally succeed by
  // reaching the database some other way.
  console.log(`[smoke] opening ${url} through ${host}`);
  const connection = await postgresStrategy.open({
    url,
    tunnel: { bastion: { host, identityFile: identityPath, extraSshArgs } },
    tableMetadata,
  });
  console.log("[smoke] tunnel up, connection open");

  try {
    const rows = await connection.dataSource.findByEq({
      table: TABLE,
      field: "status",
      value: "shipped",
      columns: ["id", "status"],
      limit: 5,
    });
    console.log(`[smoke] read ${rows.length} rows through the tunnel`);
    check(
      rows.length >= 1,
      `read nothing through the tunnel, though ${TABLE} is seeded with shipped orders`,
    );
    check(
      rows.every((r) => r.status === "shipped"),
      "rows came back that do not match the filter — the tunnel may be pointed somewhere unexpected",
    );
  } finally {
    // Closing must also stop the ssh child. A leaked one keeps the local port
    // bound, so the next open would fail to bind rather than silently reuse
    // someone else's forward.
    await connection.close();
    console.log("[smoke] connection and tunnel closed");
  }

  console.log("[smoke] OK");
}

main().catch((err) => {
  console.error("[smoke] FAIL:", err);
  process.exit(1);
});
