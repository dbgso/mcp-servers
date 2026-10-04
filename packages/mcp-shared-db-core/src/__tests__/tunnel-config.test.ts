import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  bastionConfigFromSecrets,
  pickTunnelSpec,
  tunnelConfigFromSecrets,
  type CachedSecrets,
} from "../tunnel-config.js";

const PREFIX = "TUNNELTEST";
const ENV_KEYS = [
  "SSM_TARGET",
  "SSM_REGION",
  "SSM_PROFILE",
  "SSM_DOCUMENT_NAME",
  "SSM_READY_TIMEOUT_MS",
].map((suffix) => `${PREFIX}_${suffix}`);

/** A preloaded cache: `cached` throws for anything not in `values`. */
function secrets(values: Record<string, string>): CachedSecrets {
  return {
    cached(key: string): string {
      const value = values[key];
      if (value === undefined) throw new Error(`not preloaded: ${key}`);
      return value;
    },
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("pickTunnelSpec", () => {
  const bastion = { host: "user@host" };
  const ssm = { target: "i-0123" };

  it.each([
    { bastion: null, ssm: null, expected: null },
    { bastion, ssm: null, expected: { bastion } },
    { bastion: null, ssm, expected: { ssm } },
  ])("picks $expected", ({ bastion: b, ssm: s, expected }) => {
    expect(pickTunnelSpec({ prefix: PREFIX, bastion: b, ssm: s })).toEqual(expected);
  });

  it("names both prefixed keys when both are set", () => {
    expect(() => pickTunnelSpec({ prefix: PREFIX, bastion, ssm })).toThrow(
      `Set at most one of ${PREFIX}_BASTION_HOST or ${PREFIX}_SSM_TARGET, not both`,
    );
  });
});

describe("bastionConfigFromSecrets", () => {
  it.each([
    { values: {}, expected: null },
    { values: { [`${PREFIX}_BASTION_HOST`]: "user@host" }, expected: { host: "user@host" } },
    {
      values: { [`${PREFIX}_BASTION_HOST`]: "user@host", [`${PREFIX}_BASTION_KEY`]: "~/.ssh/k" },
      expected: { host: "user@host", identityFile: "~/.ssh/k" },
    },
  ])("reads $values", ({ values, expected }) => {
    expect(bastionConfigFromSecrets({ secrets: secrets(values), prefix: PREFIX })).toEqual(
      expected,
    );
  });
});

describe("tunnelConfigFromSecrets", () => {
  it("reports no tunnel when neither signal is set", () => {
    expect(tunnelConfigFromSecrets({ secrets: secrets({}), prefix: PREFIX })).toBeNull();
  });

  it("picks SSM from a cached target, mirroring it into the environment", () => {
    const spec = tunnelConfigFromSecrets({
      secrets: secrets({ [`${PREFIX}_SSM_TARGET`]: "i-from-the-store" }),
      prefix: PREFIX,
    });

    expect(spec).toEqual({ ssm: expect.objectContaining({ target: "i-from-the-store" }) });
    expect(process.env[`${PREFIX}_SSM_TARGET`]).toBe("i-from-the-store");
  });

  it("leaves a value the environment already carries alone", () => {
    process.env[`${PREFIX}_SSM_TARGET`] = "i-from-the-shell";

    tunnelConfigFromSecrets({
      secrets: secrets({ [`${PREFIX}_SSM_TARGET`]: "i-from-the-store" }),
      prefix: PREFIX,
    });

    expect(process.env[`${PREFIX}_SSM_TARGET`]).toBe("i-from-the-shell");
  });

  it("refuses a bastion and an SSM target together", () => {
    expect(() =>
      tunnelConfigFromSecrets({
        secrets: secrets({
          [`${PREFIX}_BASTION_HOST`]: "user@host",
          [`${PREFIX}_SSM_TARGET`]: "i-0123",
        }),
        prefix: PREFIX,
      }),
    ).toThrow(/at most one/);
  });
});
