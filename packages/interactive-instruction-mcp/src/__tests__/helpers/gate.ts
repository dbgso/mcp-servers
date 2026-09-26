import type { ToolResponse } from "mcp-shared";

/** The heading every deliberation refusal starts with. */
const REFUSAL_MARKER = "Not Yet -- Tell the User First";

export function isRefusal(response: ToolResponse): boolean {
  const first = response.content[0];
  return first?.type === "text" && first.text.includes(REFUSAL_MARKER);
}

/**
 * Repeat a gated call until it goes through, and report how many attempts it
 * took.
 *
 * Tests that care about the write should not also encode the attempt count:
 * that number is policy, set per operation in `services/mutation-gate.ts` and
 * overridable by whoever runs the server, so hardcoding it here would make
 * every one of these tests fail the next time it is tuned. The tests that do
 * care assert on `attempts`, or call the handler directly and check the
 * refusal.
 */
export async function throughGate(
  call: () => Promise<ToolResponse>,
  options: { limit?: number } = {}
): Promise<{ response: ToolResponse; attempts: number }> {
  const limit = options.limit ?? 10;

  for (let attempts = 1; attempts <= limit; attempts++) {
    const response = await call();
    if (!isRefusal(response)) return { response, attempts };
  }

  throw new Error(`Gate still refusing after ${limit} identical attempts.`);
}
