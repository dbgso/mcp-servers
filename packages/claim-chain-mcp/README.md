# claim-chain-mcp

**Downstream can only say what upstream has decided.**

Each decision is a claim with an id the tool issues. A claim is written only if
it cites the claims its kind has to cite -- a criterion cites exactly one
principle, a spec behaviour cites at least one criterion, and so on. What makes a
claim correct is the kind and number of what it cites, never what its text says.

When a claim cannot be written because what it has to cite does not exist, that
is upstream missing a decision. Pass `want` and it is recorded as a gap. When the
missing claim is added upstream, `add` lists the gaps it answers, with the call
that writes each waiting draft.

## Kinds (default)

| kind | what | cites | fields | needs below |
|---|---|---|---|---|
| DEF | a term | — | term, meaning | — |
| P | a principle | DEF (1..n) | modality (`must` / `must_not`), statement | C |
| C | a criterion deciding one principle | P (1..1), DEF (0..n) | condition | S |
| S | a spec behaviour | C (1..n) | behavior | — |
| D | a design reason | S (1..n) | reason, rejected | — |

A principle has no field for a condition, so an exception to it has nowhere to be
written. `<root>/claim-chain.config.yaml` replaces the table.

## Storage

One claim per file, `<root>/<kind>/<id>.yaml`. A citation records the version of
the claim it cites (a hash of its kind and fields); when that claim changes,
`check` reports the citation as stale until it is confirmed with `update`.

## Running

```bash
claim-chain-mcp [root]        # MCP over stdio; root defaults to docs/claims
claim-chain-mcp check [root]  # the same check once; exit 1 on any error
```

Tools: `describe` (everything about the arguments) and `execute` with
`action`: `add`, `update`, `read`, `list`, `check`, `gaps`, `unblocked`, `trace`.

This repository's own claims for this server are in `docs/claims`.
