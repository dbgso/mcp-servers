import type { PendingToolCall, Rule } from "./types.js";
import { ulid } from "ulid";

const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

export interface PendingStoreOptions {
  /** Time-to-live for pending requests in milliseconds (default: 10 minutes) */
  ttlMs?: number;
}

/**
 * Store for pending tool calls awaiting approval
 */
export class PendingStore {
  private pending = new Map<string, PendingToolCall>();
  private readonly ttlMs: number;

  constructor(options: PendingStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  /**
   * Add a pending tool call
   */
  add(toolName: string, args: Record<string, unknown>, matchedRule: Rule): PendingToolCall {
    const id = ulid();
    const now = Date.now();
    const pendingCall: PendingToolCall = {
      id,
      toolName,
      args,
      matchedRule,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.pending.set(id, pendingCall);
    return pendingCall;
  }

  /**
   * Get a pending tool call by ID (returns undefined if expired)
   */
  get(id: string): PendingToolCall | undefined {
    const pending = this.pending.get(id);
    if (pending && this.isExpired(pending)) {
      this.pending.delete(id);
      return undefined;
    }
    return pending;
  }

  /**
   * Check if a pending call is expired
   */
  isExpired(pending: PendingToolCall): boolean {
    return Date.now() > pending.expiresAt;
  }

  /**
   * Remove a pending tool call (after approval or rejection)
   */
  remove(id: string): boolean {
    return this.pending.delete(id);
  }

  /**
   * List all pending tool calls (excludes expired)
   */
  list(): PendingToolCall[] {
    this.cleanup();
    return Array.from(this.pending.values());
  }

  /**
   * Remove all expired pending calls
   */
  cleanup(): number {
    let removed = 0;
    for (const [id, pending] of this.pending) {
      if (this.isExpired(pending)) {
        this.pending.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Clear all pending tool calls
   */
  clear(): void {
    this.pending.clear();
  }

  /**
   * Get count of pending calls (excludes expired)
   */
  count(): number {
    this.cleanup();
    return this.pending.size;
  }

  /**
   * Get TTL in milliseconds
   */
  getTtlMs(): number {
    return this.ttlMs;
  }
}
