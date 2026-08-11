/**
 * SSH / AWS SSM port-forward tunnels -- `mcp-shared/tunnel`.
 *
 * Adds no npm dependency (both openers shell out), but only the database
 * servers reach a bastion, so it stays off the root barrel with the rest.
 */
export {
  createSshTunnel,
  withSshTunnel,
  resolveTunneledUrl,
  bastionConfigFromEnv,
  buildSshArgs,
  expandHome,
  isLoopbackHost,
  findFreePort,
  isPortAcceptingConnections,
  bastionTunnelOpener,
  ssmTunnelOpener,
  pickTunnelOpener,
} from "./utils/ssh-tunnel.js";

export type {
  SshTunnelConfig,
  SshTunnel,
  BastionConfig,
  TunnelSpec,
  TunnelOpener,
  TunnelOpenerOpts,
  ResolveTunneledUrlParams,
  ResolvedTunneledUrl,
} from "./utils/ssh-tunnel.js";

export {
  createSsmTunnel,
  withSsmTunnel,
  ssmConfigFromEnv,
  buildSsmTunnelArgs,
  DEFAULT_SSM_DOCUMENT_NAME,
} from "./utils/ssm-tunnel.js";

export type { SsmTunnelConfig, SsmTunnelEnvConfig, SsmTunnel } from "./utils/ssm-tunnel.js";
