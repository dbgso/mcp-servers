---
"mcp-interactive-instruction": major
---

Consolidate every operation into two tools, and make the approval gate mean something.

**Breaking: the four tools are gone.** `description`, `help`, `draft` and `apply` are replaced by `instruction_describe` and `instruction`, with everything else an action on `instruction`. Anything naming the old tools — MCP client allow-lists, prompts, project instructions — has to be rewritten.

| 1.x | 2.0 |
|---|---|
| `description()` | `instruction_describe()` |
| `help()` / `help(recursive: true)` | `instruction(action: "list")` / `… recursive: true` |
| `help(id: "<id>")` | `instruction(action: "read", id: "<id>")` |
| `draft(action: "list" \| "read" \| "add" \| "update" \| "delete" \| "rename")` | `instruction(action: <same>)` |
| `apply(action: "list")` | `instruction(action: "list")` |
| `apply(action: "promote", draftId, targetId)` | `instruction(action: "approve", …)` |

`promote` no longer exists: promotion goes through `approve`, which requires an `explanation` and refuses the first attempt. `add` now requires `description` and `whenToUse`. Updating a promoted document is two steps — `update` stages a diff, `apply` writes it. The command line is unchanged, so `.mcp.json` needs no edit, and documents written by 1.x are read as they are.

**A gated change is bound to what was disclosed.** The shared approval primitive has supported content-binding all along; nothing here used it. So an approval was keyed on the draft id and nothing else, while what actually got written came from the arguments supplied *after* the human handed over the token: `targetId` was read again at that point and applied with `overwrite: true`, so a token approved for "create a new note" could be spent replacing any promoted document. Draft edits need no approval, so approving a diff and then rewriting the draft promoted content nobody saw. `link_add` / `link_remove` took the applied `relatedDocs` from the apply-time arguments. All of it is bound to the tool-computed change now, and the preview the caller reads names the target and says whether anything is being overwritten.

None of that could have been caught by the tests: the suite stubbed `validateApproval` to return valid for every call in the package, so no test in it had ever run the approval gate.

**Document ids can no longer escape the documents directory.** `__` is the hierarchy separator, so an id is an untrusted path fragment, and `..__home__.claude__CLAUDE` resolved straight out of the tree. Since nothing about `update` → `apply` names the file it will write, that was an undisclosed overwrite of any `.md` file the process could reach. The validator that would have rejected it existed but was referenced only by its own test.

**There is no desktop notification and no approval token anywhere in this server.** 1.x delivered a one-time token out-of-band for promotion, deletion and rename. It cost a human round trip on every maintenance operation, and in a headless or SSH session — which is where this server mostly runs — it could not be delivered at all: the operation simply became impossible, and the only remedy was to tell the user their notifications were broken.

Every gated mutation now goes through one gate, the deliberation gate, and which gate that is is decided in one place (`src/services/mutation-gate.ts`) rather than per handler. Each takes an `explanation` — what the change does and why, in the agent's own words, as it gave it to you. The first attempt is refused, with the preview of what would change; only an identical repeat goes through. `delete` and `rename` take three attempts, everything else two, overridable per operation (`IIMCP_DELIBERATION_ATTEMPTS_DELETE=5`). `approvalToken` and `confirmed` are no longer accepted by any action.

**Be precise about what that gives up.** The token made a swapped target *impossible*: the proof was minted for one change and validated against another. Deliberation makes it *visible* — a run is keyed on the operation, the tool-computed change and the explanation verbatim, so a repeat that quietly changed the target, the content or the wording is a new run refused from attempt one. But an agent that has been refused can open a fresh run for the swapped change and push that through at the cost of one more disclosure round, and nothing verifies a human read anything.

What carries the risk instead is reversibility. **A deleted promoted document is moved to `_mcp_trash/` rather than unlinked**, under a timestamped name, so a delete is undone by moving the file back; nothing reads that directory, so the document is gone from every listing. `apply` still refuses if the document changed after the diff was computed, and refuses — discarding the staged update — if the document has since been deleted; it used to write the stored path with no check at all, silently dropping concurrent edits and resurrecting deleted documents. If your corpus holds something where an uncooperative agent getting through would be genuinely damaging, this is the wrong gate for it, and `mcp-shared`'s token strategy is still there to install.

The promotion state machine also advances only after the file has moved. Triggering it first left a failed rename with a draft stamped `applied` and nothing on disk — invisible under the token, which was spent by then, but the gate's surviving run means there is now a next attempt to strand.

**A write no longer destroys the parts of a document it was not asked about.** Adding one `relatedDocs` entry used to delete unknown frontmatter keys, drop comments and blank lines, reorder what survived, and leave quoted values carrying their quote marks into search results. Frontmatter is now edited in place rather than reconstructed.

**A draft's workflow state ends when the draft's life ends.** The persisted entry survived promotion, so a later draft reusing that id inherited a `pending_approval` state and could be promoted through the batch path with no self-review and no explanation to the user. State is also scoped per documents directory now, so two servers on one machine stop sharing it. `set_status` only resets a draft to `editing` — it used to accept the later states and write them into frontmatter that nothing read, leaving a stuck draft stuck.

**Staged updates are scoped per documents directory.** They lived in one shared temp directory keyed loosely enough that two ids could collide, so one server's `apply` could write another server's file and report success under the wrong id.

**New: `graph` and scoping.** `instruction(action: "graph")` renders the `relatedDocs` graph as an interactive page — links pointing at documents that do not exist are drawn rather than dropped, because finding those is a reason to open it. `--include` / `--exclude` say which documents in the directory this server manages, for a directory it shares with another tool. The cose-family layouts (`cose`, `fcose`, `cola`, `cise`, `avsdf`) laid every node on top of its neighbours, hiding all of the edges -- a corpus with 126 relations looked like one with none, with no error anywhere to say otherwise. Nodes are sized by their label, which is not resolved until the page has rendered once, so a layout run from the constructor placed them as points.

`node-notifier` is no longer a dependency of this package, and a source-level test keeps it that way: the notification came back last time one handler at a time, each written against `requestApproval` because the handler next to it did.

**Metadata can be changed without resending the document.** `update`'s `content` is now optional: `update(id, description, whenToUse)` edits the frontmatter and leaves the body alone. Resending a whole document to fix one `whenToUse` entry was the reason metadata went unmaintained, and on a promoted document it staged a diff whose noise hid the one line that actually moved. `update_meta`, which used to print a prompt telling the caller to do exactly that resend, now shows what the metadata says today alongside the documents one hop away in the `relatedDocs` graph — or, for a document nothing links to, the other documents under its category as candidates for where it belongs.

**The size warning counts the body, not the frontmatter.** Describing a document well used to spend its line budget: a fifth `whenToUse` entry was a line against the 150-line limit, so `lint` rewarded thin metadata and eventually warned about documents whose prose was well inside it.

**A write terminates the file, and touches nothing it was not asked to.** Documents written through the server came out with no trailing newline while hand-edited ones kept theirs, so a metadata-only change showed the last line of the body as a `-`/`+` pair in `git diff` and the files stopped being POSIX text. Every write now goes through the reader, which is also the only path that checks the document is in scope and invalidates the list cache -- `link_add` and `link_remove` were writing with `fs.writeFile` and a bare path, skipping all three.

**`add` keeps the metadata written in its `content`.** The frontmatter in `content` used to be discarded and rebuilt from the arguments, so `relatedDocs` written there was dropped in silence -- and since the prose still reads correctly, the loss shows up only when the graph is drawn. Arguments still win where both say something.

**Promotion no longer publishes the workflow's own fields.** `status`, `selfReviewNotes` and `confirmedAt` exist to run the approval conversation; they were left in the promoted document, so every reader of it got the AI's self-review notes at the top. `approvedAt` stays: when a document joined the corpus is a fact about the document.

**`update` accepts `relatedDocs`.** It was silently ignored, which is the worst of the three options -- the caller is told the update was prepared and the link is not in it. Passing it replaces the list; `link_add` / `link_remove` remain the incremental pair.

**The server no longer writes to your documents directory at startup.** It used to create `_mcp-interactive-instruction/draft-approval.md` -- 92 lines of approval-format rules -- before anything had been called, and since that path is not one of the internal directories, `list` showed it next to the user's own documents on every call. The format it carried (where the document goes, what it says, why there) is now part of the `approve` response that records the self-review, so it arrives when it is acted on rather than in a document someone has to be told to read. A copy left over from an earlier version is the user's to delete; the server will not touch it.

**`lint` reads structure, not only length.** Line count is a proxy for "one topic, one claim" and a poor one: a reference table is worth more whole than split across three files, and a runbook read out of order is not a runbook. A document can now exempt itself with `sizeExemption: <why>` -- a reason, not a flag, so the next reader can tell a decision from a warning nobody got to. An exemption with no reason is reported, and so is one on a document that is now within the limit, since nothing else would ever mention it again. Separately, the same heading twice in one document is reported: that is what appending to the end of a document looks like, and the appended part is often a topic of its own. It is reported whatever the size says -- being deliberately long says nothing about the structure being sound.

