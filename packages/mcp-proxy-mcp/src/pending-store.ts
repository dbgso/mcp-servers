import type { PendingToolCall, Rule } from "./types.js";
import { ulid } from "ulid";

/**
 * Store for pending tool calls awaiting approval
 */
export class PendingStore {
  private pending = new Map<string, PendingToolCall>();

  /**
   * Add a pending tool call
   */
  add(toolName: string, args: Record<string, unknown>, matchedRule: Rule): PendingToolCall {
    const id = ulid();
    const pendingCall: PendingToolCall = {
      id,
      toolName,
      args,
      matchedRule,
      createdAt: Date.now(),
    };
    this.pending.set(id, pendingCall);
    return pendingCall;
  }

  /**
   * Get a pending tool call by ID
   */
  get(id: string): PendingToolCall | undefined {
    return this.pending.get(id);
  }

  /**
   * Remove a pending tool call (after approval or expiration)
   */
  remove(id: string): boolean {
    return this.pending.delete(id);
  }

  /**
   * List all pending tool calls
   */
  list(): PendingToolCall[] {
    return Array.from(this.pending.values());
  }

  /**
   * Clear all pending tool calls
   */
  clear(): void {
    this.pending.clear();
  }

  /**
   * Get count of pending calls
   */
  count(): number {
    return this.pending.size;
  }
}
