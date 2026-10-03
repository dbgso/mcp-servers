---
"mcp-interactive-instruction": patch
---

Frontmatter that does not parse is reported as itself, and not written over.

A description containing an unquoted `: ` is a mapping rather than a string, so the YAML parse fails for the whole block. Reading is deliberately forgiving and hands back whatever it resolved, which meant a document in that state was indistinguishable from one with no metadata: `lint` reported a missing description and a missing `whenToUse`, neither of which was the cause, and a `relatedDocs` entry plainly present in the file was invisible, so the document it named was reported as an orphan. One unquoted colon produced four findings, three naming the wrong thing and one simply false.

`frontmatter-unreadable` is now reported instead, as an error, carrying the parser's own message and position, and it suppresses the missing-metadata findings that are its consequences — the fix for all of them is the same pair of quotes.

**And the write path no longer takes the metadata with it.** `updateFrontmatter` starts from an empty block when the existing one cannot be read, on the sound reasoning that rewriting a guess over the file is worse than losing what could not be parsed. That is right about not guessing and wrong about the silence: a caller who asked to change a description had `whenToUse` and `relatedDocs` deleted without being told, and on a draft there is no diff to notice it in. `add` and `update` refuse now, and say what is wrong with the file; after the repair, every other field survives the write as usual. `add` is refused for the same reason it is documented as keeping the metadata written in its `content`.

`read_meta` shows the block as written when it cannot be parsed. Refusing the write is only half of it: `read` hides frontmatter by design and every other action reads an unparsed block as absent, so a caller told their YAML is wrong at line 1 column 14 had nowhere to go and look at line 1 -- `read_meta` printed all three fields as "(not set)" and advised writing a description, which is not the repair.

Found by doing it by hand to this repository's own corpus, which is also why `workflow__edit-docs-through-the-tool` exists.
