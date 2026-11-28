---
"claim-chain-mcp": minor
---

A new server for holding decisions as claims that can only cite what upstream has decided.

Each claim has a kind (DEF, P, C, S, D by default) and is written only if it cites claims of the kinds its kind has to cite, in the right number. When it cannot be written because what it has to cite does not exist, passing `want` records a gap; when the missing claim is added upstream, `add` lists the gaps it answers. `check` reports missing and wrong-kind citations, claims nothing below them decides, and citations made against an older version of what they cite. The same check runs as `claim-chain-mcp check <root>` and exits 1 on any error.
