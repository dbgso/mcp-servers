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

`promote` no longer exists: promotion goes through `approve`, which needs a token a human reads from a desktop notification. `add` now requires `description` and `whenToUse`. Updating a promoted document is two steps — `update` stages a diff, `apply` writes it. The command line is unchanged, so `.mcp.json` needs no edit, and documents written by 1.x are read as they are.

**Approvals are bound to the change they were granted for.** The shared approval primitive has supported content-binding all along; nothing here used it. So an approval was keyed on the draft id and nothing else, while what actually got written came from the arguments supplied *after* the human handed over the token: `targetId` was read again at that point and applied with `overwrite: true`, so a token approved for "create a new note" could be spent replacing any promoted document. Draft edits need no approval, so approving a diff and then rewriting the draft promoted content nobody saw. `link_add` / `link_remove` took the applied `relatedDocs` from the apply-time arguments. All of it is content-bound now, and the notification names the target and says whether anything is being overwritten.

None of that could have been caught by the tests: the suite stubbed `validateApproval` to return valid for every call in the package, so no test in it had ever run the approval gate.

**Document ids can no longer escape the documents directory.** `__` is the hierarchy separator, so an id is an untrusted path fragment, and `..__home__.claude__CLAUDE` resolved straight out of the tree. Since `update` → `apply` asks for no token, that was an unapproved overwrite of any `.md` file the process could reach. The validator that would have rejected it existed but was referenced only by its own test.

**`apply` verifies what it is about to overwrite**, and is gated by deliberation rather than a token. It refuses if the document changed after the diff was computed, and refuses — discarding the staged update — if the document has since been deleted; it used to write the stored path with no check at all, silently dropping concurrent edits and resurrecting documents deleted under an approval token. The gate refuses the first attempt and asks the agent to explain the change to you; only a second identical attempt goes through. That is disclosure, not consent, which is the right trade for an operation whose worst outcome is a document with the wrong text in it, and it works in a headless session where no token can be delivered. Deletion, rename and promotion keep their tokens.

**A write no longer destroys the parts of a document it was not asked about.** Adding one `relatedDocs` entry used to delete unknown frontmatter keys, drop comments and blank lines, reorder what survived, and leave quoted values carrying their quote marks into search results. Frontmatter is now edited in place rather than reconstructed.

**A draft's workflow state ends when the draft's life ends.** The persisted entry survived promotion, so a later draft reusing that id inherited a `pending_approval` state and could be promoted through the batch path with no self-review and no explanation to the user. State is also scoped per documents directory now, so two servers on one machine stop sharing it. `set_status` only resets a draft to `editing` — it used to accept the later states and write them into frontmatter that nothing read, leaving a stuck draft stuck.

**Staged updates are scoped per documents directory.** They lived in one shared temp directory keyed loosely enough that two ids could collide, so one server's `apply` could write another server's file and report success under the wrong id.

**New: `graph` and scoping.** `instruction(action: "graph")` renders the `relatedDocs` graph as an interactive page — links pointing at documents that do not exist are drawn rather than dropped, because finding those is a reason to open it. `--include` / `--exclude` say which documents in the directory this server manages, for a directory it shares with another tool.

Approvals now report a delivery failure instead of claiming a notification was sent, and `MCP_APPROVAL_TEST_TOKEN` is honored only under a test run — the variable is readable by anything sharing the process environment, including the agent whose request is being gated.

**Metadata can be changed without resending the document.** `update`'s `content` is now optional: `update(id, description, whenToUse)` edits the frontmatter and leaves the body alone. Resending a whole document to fix one `whenToUse` entry was the reason metadata went unmaintained, and on a promoted document it staged a diff whose noise hid the one line that actually moved. `update_meta`, which used to print a prompt telling the caller to do exactly that resend, now shows what the metadata says today alongside the documents one hop away in the `relatedDocs` graph — or, for a document nothing links to, the other documents under its category as candidates for where it belongs.

**The size warning counts the body, not the frontmatter.** Describing a document well used to spend its line budget: a fifth `whenToUse` entry was a line against the 150-line limit, so `lint` rewarded thin metadata and eventually warned about documents whose prose was well inside it.

