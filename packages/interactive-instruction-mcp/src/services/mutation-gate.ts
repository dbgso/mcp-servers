/**
 * The one place this server decides how a mutation is gated.
 *
 * It used to be decided per handler, and the handlers disagreed. `apply` and
 * the link actions deliberated; `delete`, `rename` and `approve` called
 * `requestApproval` / `validateApproval` directly and delivered a token over a
 * desktop notification. Nothing chose between them -- each handler had simply
 * been written at a different time -- so changing the mechanism meant editing
 * five files, and the `ApprovalStrategy` interface that exists to prevent that
 * was bypassed by all five.
 *
 * The notification is gone. It cost a human round trip on every maintenance
 * operation, it cannot be delivered at all in a headless or SSH session (which
 * is where this server mostly runs), and the failure mode was the worst kind:
 * the operation became impossible and the only remedy was to tell the user
 * their notifications were broken.
 *
 * What replaces it is deliberation everywhere, at an attempt count set per
 * operation below. Be clear about what that is: DISCLOSURE, not CONSENT.
 * Nothing here verifies a human read anything. An operation whose risk needs
 * consent cannot be carried by this gate, so the risk is carried by
 * reversibility instead -- which is why `delete` moves a file to the trash
 * rather than unlinking it, and why `rename` keeps its backlink rewrite
 * inside one operation that can be run backwards.
 */

import { DeliberationGate } from "mcp-shared/approval";
import type { ToolResponse } from "mcp-shared";
import { textResponse } from "../tools/instruction/types.js";

/**
 * The operations this server gates.
 *
 * Grouped by what the operation is, not by which handler runs it: `link` covers
 * both `link_add` and `link_remove`, which are inverses sharing one gate.
 */
export type GatedOperation = "apply" | "link" | "approve" | "rename" | "delete";

/**
 * How many identical attempts each operation takes.
 *
 * Two is the ordinary setting: one refusal is what forces the explanation into
 * the transcript, and further repetitions add friction without adding
 * information. Three is for the operations that cannot be undone by asking for
 * the opposite -- a rename moves every backlink with it, and a delete is a
 * delete even with a trash directory behind it.
 */
const DEFAULT_ATTEMPTS: Record<GatedOperation, number> = {
  apply: 2,
  link: 2,
  approve: 2,
  rename: 3,
  delete: 3,
};

/**
 * Per-operation override, e.g. `IIMCP_DELIBERATION_ATTEMPTS_DELETE=5`.
 *
 * The right number depends on how much the person running the server trusts
 * the agent using it, which is not something this file can know. An unreadable
 * or out-of-range value is ignored rather than throwing: a typo in an
 * environment variable should not stop the server from starting, and the
 * default it falls back to is the safe direction.
 */
function configuredAttempts(operation: GatedOperation): number {
  const raw = process.env[`IIMCP_DELIBERATION_ATTEMPTS_${operation.toUpperCase()}`];
  if (raw === undefined) return DEFAULT_ATTEMPTS[operation];

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_ATTEMPTS[operation];
  return parsed;
}

/**
 * One gate per operation, built on first use.
 *
 * Per operation rather than one shared gate, because the attempt count differs;
 * runs within a gate are already keyed, so two documents being deleted at once
 * do not evict each other.
 */
const gates = new Map<GatedOperation, DeliberationGate>();

function gateFor(operation: GatedOperation): DeliberationGate {
  const existing = gates.get(operation);
  if (existing !== undefined) return existing;

  const gate = new DeliberationGate({ requiredAttempts: configuredAttempts(operation) });
  gates.set(operation, gate);
  return gate;
}

/**
 * Put a mutation behind this server's gate.
 *
 * Handlers pass what changes and how they described it, and get back either the
 * work's response or the refusal. They do not name a mechanism, which is the
 * point: the next time the mechanism changes, it changes here.
 */
export async function gateMutation(params: {
  operation: GatedOperation;
  /** Identifies this particular change, e.g. `instruction::delete::<id>`. */
  subject: string;
  /**
   * Tool-computed ground truth of what will change. Part of the run key, so a
   * caller that comes back with a different change starts over rather than
   * spending a run opened for something else.
   */
  what: string;
  /** The caller's account of the change, as it gave it to the user. */
  explanation: string;
  /**
   * Shown above the refusal. The preview and the request to explain belong in
   * the same response: as separate calls, the explanation got written after the
   * decision rather than as part of making it.
   */
  preview?: string;
  work: () => Promise<ToolResponse>;
}): Promise<ToolResponse> {
  const { operation, subject, what, explanation, preview, work } = params;

  return gateFor(operation).run({
    request: { operation: subject, what, explanation },
    work,
    // A handler reports failure by returning an error response, not by
    // throwing, so this is the only reading of "the work happened". A failed
    // write leaves the run standing on purpose: the user has heard the
    // explanation once and should not have to hear it again.
    succeeded: (response) => response.isError !== true,
    // Not an error response. Being refused is a step of the operation, and
    // dressing it as a tool failure invites the caller to decide the tool is
    // broken and look for another way in.
    onRefused: (refused) =>
      textResponse(preview === undefined ? refused.message : `${preview}\n\n---\n\n${refused.message}`),
  });
}

/** Only for tests: a gate is process memory and outlives a single case. */
export function resetMutationGatesForTesting(): void {
  for (const gate of gates.values()) gate.resetAllForTesting();
  gates.clear();
}
