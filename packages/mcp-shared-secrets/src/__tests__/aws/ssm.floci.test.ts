import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ssmSource } from "../../aws/ssm.js";

/**
 * Real cloud roundtrip against the floci emulator (real engine, NOT a mocked
 * spawnFn). Exercises the default `ssmSource()` path: real
 * `child_process.execFile` -> real `aws` CLI -> floci on :4566.
 *
 * Gated on AWS_ENDPOINT_URL (CI sets it; locally `docker compose up -d floci`
 * then export the AWS_* vars). See secrets-manager.floci.test.ts for details.
 */
const execFileAsync = promisify(execFile);
const hasEmulator = Boolean(process.env.AWS_ENDPOINT_URL);

if (hasEmulator) {
  process.env.AWS_ACCESS_KEY_ID ??= "test";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test";
  process.env.AWS_REGION ??= "us-east-1";
}

const PARAM_NAME = "/mcp-shared-secrets/integration/db-password";

describe.skipIf(!hasEmulator)("ssmSource (floci integration)", () => {
  beforeAll(async () => {
    await execFileAsync("aws", [
      "ssm",
      "put-parameter",
      "--name",
      PARAM_NAME,
      "--value",
      "s3cr3t",
      "--type",
      "SecureString",
      "--overwrite",
    ]);
  });

  it("fetches a real parameter through the default execFile path (no mock)", async () => {
    const src = ssmSource(); // no spawnFn -> real aws CLI -> floci
    await expect(src.fetch(PARAM_NAME)).resolves.toBe("s3cr3t");
  });

  it("returns undefined for a missing parameter (ParameterNotFound -> undefined)", async () => {
    const src = ssmSource();
    await expect(src.fetch("/mcp-shared-secrets/integration/does-not-exist")).resolves.toBeUndefined();
  });
});
