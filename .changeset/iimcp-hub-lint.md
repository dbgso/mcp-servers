---
"mcp-interactive-instruction": minor
---

Three lint rules for the hub and the documents under it.

A corpus built out of hubs stakes everything on the hub being right, and nothing was looking. `every-task` named five `workflow__*` rules one by one while no `workflow` document existed; it was found by reading it and fixed by hand, with the cause written into the document being edited -- "this file naming each rule is how the list and the directory come to disagree about what exists" -- and nothing left behind that would catch the next one.

`prefer-hub-reference` reports a document that names several children of one family instead of the document that indexes them. When the hub exists it says to point at the hub; when it does not, it says to write it, because a scattered list is then the only index of that family anywhere. That second case is the one the rule was written for, and a rule that waited for the hub to appear would have stayed silent through all of it. The hub itself is exempt -- listing its children is its job -- and so is a sibling cross-referencing its own family.

`stale-hub-index` reports a hub whose list no longer matches the directory, in both directions: children that sit under it and go unnamed, and names with no document behind them. On this repository's own corpus it finds `release`, which does not reference three of its own children.

`misplaced-hub` reports an `overview`, `index` or `readme` sitting inside a family that has no hub. At that id it is a sibling of the documents it means to index, so a reference to it is not a reference to the family and neither of the other two rules reaches it -- `stale-hub-index` needs a document at the family's id to check, and not having one is the defect. This repository's `coding-rules__overview` named 14 of its 18 siblings, plus one document belonging to a different family, and nothing said so. It came out of writing down what a hub is, which is the order that was skipped: the detection was built first, and could only find the cases the criterion had not yet been written to cover.

**`describe()` carries what a hub is**, under "The hub of a family": when a family needs one, that it lives at the family's id, one line per member, and why the hub's own list is the part that rots. The rules are compiled into the package and run against whatever corpus the server is pointed at; `npm pack` ships `dist`, `templates`, `README.md` and `LICENSE`, and nothing from `docs/`. A criterion written as a document in one repository's corpus therefore reaches nobody who installs this -- they are told to rename their `overview` with nothing to read about why. `describe()` is the surface that travels with the rule, and the flow and the guidance tests assert it stays there.

The first two read `relatedDocs` and the prose alike, since the list that started this was written in the body as a `See` line naming `workflow__dry-principle`. Only ids carrying the `__` separator are searched for: a hub is named for what it is about, and looking for the bare word `policy` in prose would report a sentence as a reference. The threshold is `IIMCP_LINT_HUB_CHILDREN` (default 2) -- where a corpus draws the line between citing two documents and indexing them is a property of the corpus.
