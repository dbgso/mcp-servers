import * as crypto from "node:crypto";

/**
 * Stable hash of the exact content an action would apply.
 *
 * Lives outside the approval module on purpose. Binding a request to its
 * content is what makes an approval mean something, but the hash itself is
 * plain crypto -- and the approval module reaches desktop notifications, which
 * anything merely needing a hash should not have to carry.
 */
export function contentHash(input: string): string {
  return crypto.createHash("sha256").update(input, "utf-8").digest("hex");
}
