/**
 * The sessions this server is holding open.
 *
 * Process memory, deliberately: a session is a running child, so it cannot
 * outlive the process that spawned it, and persisting the ids would only
 * promise something the next start could not keep.
 */

import type { LabSession } from "./session.js";

export class SessionStore {
  private readonly sessions = new Map<string, LabSession>();
  private counter = 0;

  /** Sequential rather than random: these ids are typed by hand, repeatedly. */
  nextId(): string {
    this.counter += 1;
    return `s${this.counter}`;
  }

  add(session: LabSession): void {
    this.sessions.set(session.id, session);
  }

  get(id: string): LabSession | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): void {
    this.sessions.delete(id);
  }

  all(): LabSession[] {
    return [...this.sessions.values()];
  }

  /** Every child dies with this process; nothing here is worth leaking. */
  async stopAll(): Promise<void> {
    await Promise.all(this.all().map((session) => session.stop({ keepScratch: false })));
    this.sessions.clear();
  }
}
