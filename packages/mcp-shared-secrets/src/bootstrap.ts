import { loadEnvFile } from "./dotenv.js";
import type { SecretResolver } from "./resolver.js";

/** The start-up seams every resolver-backed server accepts. */
export interface BootstrapSeams<C> {
  /** Pre-parsed CLI arguments (preferred over re-parsing argv). */
  cli?: C;
  /** Pre-built resolver (test seam). When omitted, `buildResolver` makes one. */
  resolver?: SecretResolver;
  /** Test seam: dotenv loader. Defaults to `loadEnvFile`. */
  loadEnvFile?: (path: string) => unknown;
}

export interface BootstrapResolverParams<C extends { envFile?: string }, O extends BootstrapSeams<C>> {
  /** Raw argv, or options carrying already-parsed CLI arguments and seams. */
  argvOrOptions: readonly string[] | O;
  /** The server's own argv parser, used when `argvOrOptions` is argv. */
  parseArgs: (argv: readonly string[]) => C;
  /**
   * What to do when options arrive without `cli`: return the arguments to use
   * instead (a server whose flags are all optional), or throw (one that cannot
   * start without them).
   */
  onMissingCli: () => C;
  /** Builds the resolver when the options do not inject one. */
  buildResolver: () => SecretResolver;
  /** Keys to preload so tools can read them synchronously. */
  secretKeys: readonly string[];
}

export interface BootstrappedResolver<C, O> {
  /** The options as given, or `{ cli }` when argv was passed. */
  options: O;
  cli: C;
  resolver: SecretResolver;
}

/**
 * The start of every resolver-backed server's startServer: normalise argv or
 * options, load `--env-file` when one was named, then build (or accept) the
 * resolver and preload its keys. What each server does after that -- open a
 * connection, register tools -- stays with the server.
 */
export async function bootstrapResolver<C extends { envFile?: string }, O extends BootstrapSeams<C>>(
  params: BootstrapResolverParams<C, O>,
): Promise<BootstrappedResolver<C, O>> {
  const { argvOrOptions } = params;
  const options = isArgv(argvOrOptions)
    ? ({ cli: params.parseArgs(argvOrOptions) } as O)
    : argvOrOptions;
  const cli = options.cli ?? params.onMissingCli();

  // A named env file is always loaded, so `--env-file ""` fails loudly
  // ("Env file not found") instead of starting without the file.
  const load = options.loadEnvFile ?? loadEnvFile;
  if (cli.envFile !== undefined) load(cli.envFile);

  const resolver = options.resolver ?? params.buildResolver();
  await resolver.preload([...params.secretKeys]);

  return { options, cli, resolver };
}

function isArgv<O>(v: readonly string[] | O): v is readonly string[] {
  return Array.isArray(v);
}
