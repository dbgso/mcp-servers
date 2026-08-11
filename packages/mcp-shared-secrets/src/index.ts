export type { SecretSource } from "./source.js";
export type {
  ParsedUri,
  ParseSecretUriParams,
  SecretResolver,
  SecretResolverConfig,
} from "./resolver.js";
export { parseSecretUri, createSecretResolver } from "./resolver.js";
export { envSource } from "./env-source.js";
export { loadEnvFile } from "./dotenv.js";
export {
  composeDbUrlFromResolver,
  DB_URL_PART_SUFFIXES,
} from "./db-url.js";
export type {
  ComposeDbUrlFromResolverParams,
  ComposedDbUrl,
  DbUrlPartSuffix,
} from "./db-url.js";

// AWS sources (zero npm deps; runtime requires `aws` CLI on PATH).
// Users who don't need AWS can simply omit them from the resolver schemes.
export {
  awsExec,
  buildAwsArgs,
  translateAwsError,
  ssmSource,
  secretsManagerSource,
} from "./aws/index.js";
export type { AwsExecOptions, ExecFileFn } from "./aws/index.js";
