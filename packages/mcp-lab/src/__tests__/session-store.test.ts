import { describe, it, expect } from "vitest";
import { SessionStore } from "../session-store.js";
import type { LabSession } from "../session.js";

/** Enough of a session for the store, which only ever reads the id. */
function fakeSession(id: string): LabSession {
  return { id, stop: async () => {} } as unknown as LabSession;
}

describe("SessionStore", () => {
  it("hands out sequential ids, which are what a caller types", () => {
    const store = new SessionStore();

    expect([store.nextId(), store.nextId(), store.nextId()]).toEqual(["s1", "s2", "s3"]);
  });

  it("does not reuse an id after the session is removed", () => {
    // Reuse would point a stale id at a different server.
    const store = new SessionStore();
    const first = store.nextId();
    store.add(fakeSession(first));
    store.remove(first);

    expect(store.nextId()).toBe("s2");
  });

  it("finds a session by id, and reports nothing for an unknown one", () => {
    const store = new SessionStore();
    store.add(fakeSession("s1"));

    expect(store.get("s1")?.id).toBe("s1");
    expect(store.get("s9")).toBeUndefined();
  });

  it("lists what is running", () => {
    const store = new SessionStore();
    store.add(fakeSession("s1"));
    store.add(fakeSession("s2"));

    expect(store.all().map((s) => s.id)).toEqual(["s1", "s2"]);
  });

  it("empties itself when everything is stopped", async () => {
    const store = new SessionStore();
    store.add(fakeSession("s1"));
    await store.stopAll();

    expect(store.all()).toEqual([]);
  });
});
