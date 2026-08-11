import { describe, it, expect, beforeAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { secretsManagerSource } from "../../aws/secrets-manager.js";

/**
 * Real cloud roundtrip against the floci emulator (real engine, NOT a mocked
 * spawnFn). Exercises the default `secretsManagerSource()` path: real
 * `child_process.execFile` -> real `aws` CLI -> floci on :4566.
 *
 * Gated on AWS_ENDPOINT_URL so it only runs where an emulator is available:
 *   CI sets it (see .github/workflows/ci.yml); locally run `docker compose up -d floci`
 *   then `export AWS_ENDPOINT_URL=http://localhost:4566 AWS_ACCESS_KEY_ID=test \
 *          AWS_SECRET_ACCESS_KEY=test AWS_REGION=us-east-1`.
 */
const execFileAsync = promisify(execFile);
const hasEmulator = Boolean(process.env.AWS_ENDPOINT_URL);

// Emulator creds/region are dummy; fill any the caller left unset so both the
// seeding CLI and the source's inherited-env execFile reach floci.
if (hasEmulator) {
  process.env.AWS_ACCESS_KEY_ID ??= "test";
  process.env.AWS_SECRET_ACCESS_KEY ??= "test";
  process.env.AWS_REGION ??= "us-east-1";
}

const SECRET_NAME = "mcp-shared-secrets/integration/db-password";

async function seedSecret(name: string, value: string): Promise<void> {
  try {
    await execFileAsync("aws", ["secretsmanager", "create-secret", "--name", name, "--secret-string", value]);
  } catch {
    // Already exists from a previous run — overwrite the value instead.
    await execFileAsync("aws", ["secretsmanager", "put-secret-value", "--secret-id", name, "--secret-string", value]);
  }
}

describe.skipIf(!hasEmulator)("secretsManagerSource (floci integration)", () => {
  beforeAll(async () => {
    await seedSecret(SECRET_NAME, "s3cr3t");
  });

  it("fetches a real secret through the default execFile path (no mock)", async () => {
    const src = secretsManagerSource(); // no spawnFn -> real aws CLI -> floci
    await expect(src.fetch(SECRET_NAME)).resolves.toBe("s3cr3t");
  });

  it("returns undefined for a missing secret (ResourceNotFound -> undefined)", async () => {
    const src = secretsManagerSource();
    await expect(src.fetch("mcp-shared-secrets/integration/does-not-exist")).resolves.toBeUndefined();
  });
});
