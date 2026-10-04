/**
 * The shared start of a resolver-backed server. The two servers that use it
 * differ only in what happens without CLI arguments -- db-read-mcp cannot
 * start, db-codegen-mcp starts with none -- so that is the parameter, and the
 * rest is the same for both.
 */
import { describe, it, expect, vi } from "vitest";
import { bootstrapResolver } from "../bootstrap.js";
import type { SecretResolver } from "../resolver.js";

interface Cli {
  envFile?: string;
  flag?: string;
}

function fakeResolver(): SecretResolver {
  return { preload: vi.fn().mockResolvedValue(undefined) } as unknown as SecretResolver;
}

const neverBuilt = (): SecretResolver => {
  throw new Error("buildResolver should not be called");
};

describe("bootstrapResolver", () => {
  it("parses argv into { cli } and builds the resolver when none is injected", async () => {
    const resolver = fakeResolver();
    const parseArgs = vi.fn((argv: readonly string[]): Cli => ({ flag: argv[0] }));

    const result = await bootstrapResolver<Cli, { cli?: Cli }>({
      argvOrOptions: ["x"],
      parseArgs,
      onMissingCli: () => ({}),
      buildResolver: () => resolver,
      secretKeys: ["A", "B"],
    });

    expect(result.options).toEqual({ cli: { flag: "x" } });
    expect(result.cli).toEqual({ flag: "x" });
    expect(result.resolver).toBe(resolver);
    expect(resolver.preload).toHaveBeenCalledWith(["A", "B"]);
  });

  it("uses injected options as given and loads the env file they name", async () => {
    const resolver = fakeResolver();
    const loadEnvFile = vi.fn();
    const options = { cli: { envFile: "/x/.env" }, resolver, loadEnvFile };

    const result = await bootstrapResolver<Cli, typeof options>({
      argvOrOptions: options,
      parseArgs: () => {
        throw new Error("parseArgs should not be called");
      },
      onMissingCli: () => ({}),
      buildResolver: neverBuilt,
      secretKeys: [],
    });

    expect(result.options).toBe(options);
    expect(loadEnvFile).toHaveBeenCalledWith("/x/.env");
  });

  it("loads a named env file even when the name is empty", async () => {
    // An empty path is a misconfiguration; loading it fails with
    // "Env file not found" rather than starting without the file.
    const loadEnvFile = vi.fn();

    await bootstrapResolver<Cli, { cli?: Cli; resolver: SecretResolver; loadEnvFile: () => void }>({
      argvOrOptions: { cli: { envFile: "" }, resolver: fakeResolver(), loadEnvFile },
      parseArgs: () => ({}),
      onMissingCli: () => ({}),
      buildResolver: neverBuilt,
      secretKeys: [],
    });

    expect(loadEnvFile).toHaveBeenCalledWith("");
  });

  it("takes the arguments onMissingCli gives when options carry none", async () => {
    const loadEnvFile = vi.fn();

    const result = await bootstrapResolver<Cli, { cli?: Cli; resolver: SecretResolver; loadEnvFile: () => void }>({
      argvOrOptions: { resolver: fakeResolver(), loadEnvFile },
      parseArgs: () => ({}),
      onMissingCli: () => ({ flag: "default" }),
      buildResolver: neverBuilt,
      secretKeys: [],
    });

    expect(result.cli).toEqual({ flag: "default" });
    // No env file named, so nothing is loaded.
    expect(loadEnvFile).not.toHaveBeenCalled();
  });

  it("stops before touching the resolver when onMissingCli throws", async () => {
    const resolver = fakeResolver();

    await expect(
      bootstrapResolver<Cli, { cli?: Cli; resolver: SecretResolver }>({
        argvOrOptions: { resolver },
        parseArgs: () => ({}),
        onMissingCli: () => {
          throw new Error("needs arguments");
        },
        buildResolver: neverBuilt,
        secretKeys: ["A"],
      }),
    ).rejects.toThrow("needs arguments");
    expect(resolver.preload).not.toHaveBeenCalled();
  });
});
