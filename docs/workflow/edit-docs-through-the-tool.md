---
description: A document under a server's corpus is changed with that server's actions, not with a file editor. The frontmatter is the reason.
whenToUse:
  - Changing a document's description, whenToUse or relatedDocs
  - About to edit a corpus file with a text editor or a script
  - A document's metadata has stopped being read
---

# Change a document with the tool that owns it

**A document in a corpus an MCP server manages is changed through that server.**
`add`, `update`, `link_add`, `rename`, `delete` — not an editor, not `sed`, not a
Python script that rewrites the frontmatter.

This is not about discipline. The tool does four things a file edit does not.

## What hand-editing loses

**The frontmatter is YAML, and writing YAML by hand is a bug waiting.** A
description containing `: ` is not a string, it is a mapping, and the parse fails
for the whole block — so a document ends up with no description *and* no
`whenToUse`, reported as two findings whose cause is neither. `updateFrontmatter`
quotes and escapes; a person typing does not. This document exists because that
happened here, to a description that read
`What a report of "it works" has to contain: what was checked`.

**Unknown keys, comments and blank lines survive a write.** The frontmatter is
edited in place rather than reconstructed, so a key nothing in the schema names is
still there afterwards, and the author's own quoting is left alone. A script that
rewrites the block keeps what it happened to know about.

**The write is checked.** `add` and `update` report the document's own lint at the
moment they write — size, repeated headings, missing metadata — while the author
still remembers why the document has the shape it has. A file edit is checked
whenever someone next runs `lint`, which is to say when it is too late to remember.

**A promoted document goes through the gate.** `update` stages a diff and `apply`
writes it, so the change is disclosed and reviewable, and the file is only touched
after the second identical call. A direct edit is a change nobody was shown.

## And it is what the gate asks

The refusal says it in as many words: *"Do not work around this by reaching for a
different tool or writing the file directly."* An author with shell access can
always do it anyway, which is the point at which this stops being a mechanism and
becomes a rule worth writing down — see `workflow__constraint-ladder` for why that
is the weakest rung and still the right one here.
