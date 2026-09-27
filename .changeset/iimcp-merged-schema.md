---
"mcp-interactive-instruction": patch
---

The one published schema stops saying things that are not true of the actions it was assembled from (#71).

`instruction` advertises a single input schema built from sixteen handlers, and the assembly kept the first declaration of each name and dropped the rest. Two consequences, one already paid for:

`sizeExemption` was written nullable on `update` and not on `add`, and `add` is registered first, so `update(id, sizeExemption: null)` -- the documented way to remove the field -- was rejected at the tool boundary while every unit test passed, because a unit test validates against the handler's own schema. And `id` is the document to act on for fifteen actions and the category to list inside for `list`; `list` is registered first, so the tool advertised "Parent ID to list documents under" as the meaning of `id` for all of them.

A divergence is refused now rather than resolved: the server will not start, and the message names both actions and says what would otherwise happen. Dropping one of two disagreeing contracts leaves the other a fiction, and the tests cannot see it from where they stand. Where the actions agree on a name, its wording is used; where they disagree, the schema says which actions take it, which of them require it, and that `instruction_describe()` has what it means in each -- rather than quoting six paragraphs into a tool list that is read every session, or presenting one action's meaning as everybody's. A parameter only one action takes now says so, which is more than the nothing `newId` and `ids` used to advertise.

Registration moved from the deprecated `server.tool` overload to `registerTool`. A discriminated union on `action` would express all of this exactly, and does not work: measured against SDK 1.26.0, `registerTool` validates one correctly -- per-action required fields and all -- and then publishes `{"type":"object","properties":{}}` for it, because the conversion to JSON Schema does not handle unions and emits nothing rather than failing. An agent reading that sees a tool with no arguments. So the published shape stays flat, every field stays optional there because a field `add` requires cannot be required of the tool that also serves `list`, and the requirement stays where it is enforced: the handler's own schema, on dispatch.
