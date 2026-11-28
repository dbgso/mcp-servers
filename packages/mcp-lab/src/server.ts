import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerLabTools } from "./tools/lab/index.js";
import { SessionStore } from "./session-store.js";
import { VERSION } from "./version.js";

/**
 * Exported so the tools can be driven over an in-memory transport in tests;
 * `startServer` is the only other way in, and it binds this process's stdin.
 */
export function createServer(params: { store?: SessionStore } = {}): {
  server: McpServer;
  store: SessionStore;
} {
  const store = params.store ?? new SessionStore();
  const server = new McpServer({ name: "mcp-lab", version: VERSION });

  registerLabTools({ server, store });
  return { server, store };
}

/**
 * Stop every child when this process is asked to stop.
 *
 * A session is a process this one spawned, so leaving them behind would leave
 * servers running with scratch directories nobody will ever remove. Exported
 * because the wiring is the part worth testing; `startServer` around it is
 * three lines that bind stdin.
 */
export function installShutdown(params: {
  store: SessionStore;
  on: (registration: { signal: NodeJS.Signals; handler: () => void }) => void;
  exit: () => void;
}): void {
  const { store, on, exit } = params;

  const shutdown = (): void => {
    void store.stopAll().finally(exit);
  };

  on({ signal: "SIGINT", handler: shutdown });
  on({ signal: "SIGTERM", handler: shutdown });
}
