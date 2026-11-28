---
"traceable-chain-mcp": minor
---

Track drift along the chain, from philosophy down to code, and walk every change back up to the root.

- New `philosophy` root type in the default chain; `requirement` now requires a philosophy. Existing chains whose requirements are roots report `missing_parent` until a philosophy is linked above them.
- Each link records the content hash of both ends when it was confirmed. `check` reports `parent_changed` / `self_changed` / `unreviewed_link` when either side moved, and `code_changed` / `code_missing` / `code_unreviewed` for code bound with `bind_code`, plus structural (`cycle`, `invalid_file`, …) and coverage (`unrealized`, `no_code`) findings. Each drifted document is escalated with its ancestors to the root.
- `confirm` clears drift once a person has re-read both sides, and refuses while anything above is unresolved, so changes are settled top-down.
- `impact` shows what a document or code path must still satisfy upstream and can invalidate downstream.
- Documents can have several parents: `link` now adds a parent instead of replacing it, and `unlink` removes one.
- `baseline` adopts documents written before baselines existed.
- New `traceable-chain` CLI over the same core (`check`, `impact`, `trace`, `list`, `confirm`, `bind`, `link`, `unlink`, `baseline`). `check` exits 1 on errors (`--strict`: also warnings), for CI and pre-commit hooks.
