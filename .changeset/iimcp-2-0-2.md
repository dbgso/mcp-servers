---
"mcp-interactive-instruction": patch
---

Two things 2.0.1 got wrong about its own new field (#73).

**A finding named a call that could not be made.** `lint` labels a draft `<id> (draft)`, because the stored id names a path rather than anything an action takes. 2.0.1 made the size findings name the call that answers them, and the label went into the call with everything else: every such finding on a draft offered `id: "big (draft)"`, which no action accepts. The label is for the reader and the id is for the tool, and they are passed separately now.

**`sizeExemption: "null"` was stored as the reason.** Some MCP clients render tool arguments as strings, so `null` -- the documented way to remove the exemption -- arrives as the four characters `null`. It was accepted, and the document ended up claiming its reason for staying whole was "null" while `stale-size-exemption` went on recommending the call that had just done nothing. A value that is not a reason is refused now, with both ways to remove the field in the refusal; an empty string removes it, since that is the one absent value a stringifying client can express; and `lint` treats a stored placeholder as no reason, so the ones 2.0.1 already wrote into a corpus are reported rather than standing.
