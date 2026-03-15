import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type {
  ListToolsResult,
  Tool,
} from "@modelcontextprotocol/sdk/types.js";
import type { TargetConfig } from "./types.js";

/**
 * Manages connection to the target MCP server
 */
export class ProxyClient {
  private client: Client;
  private transport: StdioClientTransport;
  private connected = false;
  private cachedTools: Tool[] | null = null;

  constructor(private readonly config: TargetConfig) {
    this.transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
      stderr: "pipe",
    });

    this.client = new Client(
      {
        name: "mcp-proxy-mcp",
        version: "0.1.0",
      },
      {
        capabilities: {},
      }
    );
  }

  /**
   * Connect to the target MCP server
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    await this.client.connect(this.transport);
    this.connected = true;
  }

  /**
   * Disconnect from the target MCP server
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    await this.transport.close();
    this.connected = false;
    this.cachedTools = null;
  }

  /**
   * Check if connected to the target MCP server
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * List all tools from the target MCP server
   */
  async listTools(): Promise<ListToolsResult> {
    if (!this.connected) {
      throw new Error("Not connected to target MCP server");
    }

    const result = await this.client.listTools();
    this.cachedTools = result.tools;
    return result;
  }

  /**
   * Get cached tools (if available)
   */
  getCachedTools(): Tool[] | null {
    return this.cachedTools;
  }

  /**
   * Call a tool on the target MCP server
   * Returns the raw result from the client
   */
  async callTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<Awaited<ReturnType<Client["callTool"]>>> {
    if (!this.connected) {
      throw new Error("Not connected to target MCP server");
    }

    return await this.client.callTool({
      name,
      arguments: args,
    });
  }

  /**
   * Get the process ID of the target MCP server
   */
  getPid(): number | null {
    return this.transport.pid ?? null;
  }

  /**
   * Get the target configuration
   */
  getConfig(): TargetConfig {
    return this.config;
  }
}
