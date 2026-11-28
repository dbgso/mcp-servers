import * as path from "node:path";

/**
 * What a watch may reach on the machine the server runs on.
 *
 * The server runs with the user's environment, network and file system, and
 * the agent chooses every watch's config. Without limits the `http` source
 * would be a general HTTP client (cloud metadata, internal hosts) and the
 * `file` source could read any file one regex at a time. So both are limited
 * to what whoever starts the server allows, and are closed by default where
 * an open default would be unsafe.
 */
export interface AccessPolicy {
  /**
   * Hosts the `http` source may request. An entry is an exact hostname, a
   * `*.example.com` suffix (which does not match `example.com` itself), or
   * `*` for any host. Empty means the `http` source is refused.
   */
  httpHosts: string[];
  /** Directories the `file` source may look inside (absolute). Empty means the `file` source is refused. */
  fileRoots: string[];
  /** Whether `http` returns the start of the response body in `details`. */
  returnHttpBody: boolean;
  /** Directory relative `file` paths are resolved against. */
  cwd: string;
}

export const HTTP_HOSTS_ENV = "WAIT_MCP_HTTP_ALLOW_HOSTS";
export const FILE_ROOTS_ENV = "WAIT_MCP_FILE_ROOTS";
export const RETURN_HTTP_BODY_ENV = "WAIT_MCP_HTTP_RETURN_BODY";

function splitList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

/**
 * Read the policy from the server's environment.
 *
 * - `WAIT_MCP_HTTP_ALLOW_HOSTS`: comma-separated; unset means no host.
 * - `WAIT_MCP_FILE_ROOTS`: comma-separated, relative to the working directory;
 *   unset means no directory (the working directory usually holds `.env`).
 * - `WAIT_MCP_HTTP_RETURN_BODY`: `1` / `true` to include the body excerpt.
 */
export function loadAccessPolicy(params: { env: (name: string) => string | undefined; cwd: string }): AccessPolicy {
  const { env, cwd } = params;
  return {
    httpHosts: splitList(env(HTTP_HOSTS_ENV)).map((host) => host.toLowerCase()),
    fileRoots: splitList(env(FILE_ROOTS_ENV)).map((root) => path.resolve(cwd, root)),
    returnHttpBody: /^(1|true)$/i.test(env(RETURN_HTTP_BODY_ENV)?.trim() ?? ""),
    cwd,
  };
}

/**
 * Loopback, link-local (cloud metadata) and unspecified IP literals. `*` does
 * not cover them; they must be listed exactly. Hostnames that resolve to such
 * addresses are not caught here.
 */
function isLocalIpLiteral(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, "");
  if (/^(127|0)\.\d+\.\d+\.\d+$/.test(bare) || /^169\.254\.\d+\.\d+$/.test(bare)) return true;
  return bare === "::1" || bare === "::" || /^fe[89ab][0-9a-f]:/i.test(bare) || /^::ffff:/i.test(bare);
}

function hostAllowed(params: { host: string; allowed: string[] }): boolean {
  const { host, allowed } = params;
  return allowed.some((entry) => {
    if (entry === "*") return !isLocalIpLiteral(host);
    if (entry.startsWith("*.")) return host.endsWith(entry.slice(1));
    return host === entry;
  });
}

/** Throw unless `url` is an http(s) URL on an allowed host. */
export function checkHttpUrl(params: { policy: AccessPolicy; url: string }): void {
  const { policy, url } = params;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`not a valid URL: ${url}`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`only http and https URLs can be watched, not ${parsed.protocol}`);
  }
  const host = parsed.hostname.toLowerCase();
  if (!hostAllowed({ host, allowed: policy.httpHosts })) {
    const hint =
      policy.httpHosts.length === 0
        ? `No host is allowed: set ${HTTP_HOSTS_ENV} (comma-separated hostnames, *.domain, or *) where the server is started.`
        : `Allowed: ${policy.httpHosts.join(", ")} (${HTTP_HOSTS_ENV}).`;
    throw new Error(`host "${host}" is not allowed for the http source. ${hint}`);
  }
}

/** Whether `target` is `root` or inside it. Both absolute. */
export function isInside(params: { root: string; target: string }): boolean {
  const relative = path.relative(params.root, params.target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/** Resolve `file` against the policy's cwd and throw unless it lies in an allowed root. */
export function checkFilePath(params: { policy: AccessPolicy; file: string }): string {
  const { policy, file } = params;
  const resolved = path.resolve(policy.cwd, file);
  if (policy.fileRoots.length === 0) {
    throw new Error(
      `No directory is allowed for the file source: set ${FILE_ROOTS_ENV} (comma-separated directories) where the server is started.`,
    );
  }
  if (!policy.fileRoots.some((root) => isInside({ root, target: resolved }))) {
    throw new Error(
      `path "${resolved}" is outside the directories the file source may read (${policy.fileRoots.join(", ")}; ${FILE_ROOTS_ENV}).`,
    );
  }
  return resolved;
}

/** Allows everything. For tests and embedding, never the default. */
export const OPEN_POLICY: AccessPolicy = {
  httpHosts: ["*"],
  fileRoots: [path.parse(process.cwd()).root],
  returnHttpBody: true,
  cwd: process.cwd(),
};
