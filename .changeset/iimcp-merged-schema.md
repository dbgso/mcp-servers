---
"mcp-interactive-instruction": patch
---

The `instruction` tool advertises no argument information, and `instruction_describe` carries all of it (#71).

One tool serves sixteen actions and MCP publishes one schema per tool, so every way of folding sixteen contracts into one is wrong about something. Two were tried. Merging the actions' fields and keeping the first declaration of each name advertised `list`'s meaning of `id` -- "Parent ID to list documents under" -- as its meaning for the fifteen actions that mean the document to act on, and rejected `update(id, sizeExemption: null)`, the documented way to remove that field, because `add` declared it without `null` and is registered first. A discriminated union on `action` expresses it exactly and cannot be published: measured against SDK 1.26.0, `registerTool` validates one correctly and then emits `{"type":"object","properties":{}}`, because the conversion to JSON Schema does not handle unions and returns nothing rather than failing.

So the schema says nothing. A schema that says nothing cannot be wrong about anything, the per-action detail is better in a document fetched when it is needed than in a tool list read on every session, and the tool definitions went from 5,056 characters to 648 -- about 1,150 tokens back per session. `passthrough` rather than an empty shape, and the difference is not cosmetic: an empty shape publishes the same empty `properties` and the SDK then discards every argument before the handler sees it, silently. `additionalProperties: true` says "arbitrary arguments" and hands them all over.

`update(id, sizeExemption: null)` works now, because nothing at the boundary has an opinion about it. Validation happens where the contract is -- `BaseActionHandler` parses against the handler's own schema before dispatch -- and what keeps the documentation honest is the test that holds every example in `instruction_describe` to the handler schema it would be validated against. Registration also moves off the `server.tool` overload the SDK deprecates.

`instruction_describe` is now `describe`. The prefix repeated what the server name already says -- a client reaches it as `mcp__interactive-instruction-mcp__describe` either way -- and `mcp-lab` had already settled on the bare name. Now that the schema carries nothing, this tool is where a caller has to start, so what it is called is worth getting right. Its own opening says so, rather than describing itself as an explainer for another tool.
