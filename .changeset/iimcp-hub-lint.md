---
"mcp-interactive-instruction": minor
---

Two lint rules for the hub and the documents under it.

A corpus built out of hubs stakes everything on the hub being right, and nothing was looking. `every-task` named five `workflow__*` rules one by one while no `workflow` document existed; it was found by reading it and fixed by hand, with the cause written into the document being edited -- "this file naming each rule is how the list and the directory come to disagree about what exists" -- and nothing left behind that would catch the next one.

`prefer-hub-reference` reports a document that names several children of one family instead of the document that indexes them. When the hub exists it says to point at the hub; when it does not, it says to write it, because a scattered list is then the only index of that family anywhere. That second case is the one the rule was written for, and a rule that waited for the hub to appear would have stayed silent through all of it. The hub itself is exempt -- listing its children is its job -- and so is a sibling cross-referencing its own family.

`stale-hub-index` reports a hub whose list no longer matches the directory, in both directions: children that sit under it and go unnamed, and names with no document behind them. On this repository's own corpus it finds `release`, which does not reference three of its own children.

Both read `relatedDocs` and the prose alike, since the list that started this was written as `See \`workflow__dry-principle\`` in the body. Only ids carrying the `__` separator are searched for: a hub is named for what it is about, and looking for the bare word `policy` in prose would report a sentence as a reference. The threshold is `IIMCP_LINT_HUB_CHILDREN` (default 2) -- where a corpus draws the line between citing two documents and indexing them is a property of the corpus.
