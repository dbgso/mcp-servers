import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { ClaimChain } from "../chain.js";

/** A chain over an empty scratch root, and how to remove it. */
export async function scratchChain(): Promise<{ chain: ClaimChain; root: string; cleanup: () => Promise<void> }> {
  const root = await mkdtemp(path.join(tmpdir(), "claim-chain-"));
  return { chain: new ClaimChain(root), root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** Add a claim that has to succeed, and return its id. */
export async function added(params: {
  chain: ClaimChain;
  kind: string;
  fields: Record<string, string>;
  refs?: string[];
}): Promise<string> {
  const result = await params.chain.add({ kind: params.kind, fields: params.fields, refs: params.refs ?? [] });
  if (result.outcome !== "added") throw new Error(`expected ${params.kind} to be added: ${JSON.stringify(result)}`);
  return result.claim.id;
}

/** DEF, P, C and S, each citing the one above. */
export async function seedChain(chain: ClaimChain): Promise<{ def: string; p: string; c: string; s: string }> {
  const def = await added({ chain, kind: "DEF", fields: { term: "hidden item", meaning: "something chosen not to be shown" } });
  const p = await added({
    chain,
    kind: "P",
    fields: { modality: "must_not", statement: "a hidden item is disclosed, existence included" },
    refs: [def],
  });
  const c = await added({ chain, kind: "C", fields: { condition: "a reference to a hidden item reveals nothing" }, refs: [p] });
  const s = await added({ chain, kind: "S", fields: { behavior: "answer as for a name that does not exist" }, refs: [c] });
  return { def, p, c, s };
}
