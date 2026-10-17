---
description: The decisions every server in this repository is held to, and which a server diverging from is defective rather than different.
whenToUse:
  - Building a new MCP server in this repository
  - Deciding how a tool should present itself to a caller
  - Reviewing a server that does something differently from the others
  - Judging whether a difference between servers is a choice or a defect
relatedDocs:
  - policy__mcp-tool-surface
  - policy__approval
  - policy__parameterise
  - policy__criterion-before-detection
  - policy__sharpen-over-exempt
---

# Policy

What every server here is held to, as opposed to how any one of them is written.

`coding-rules` says how to write the code. This says what the code has to come
out as. The difference is what happens when something does not match: a coding
rule is advice a reviewer may waive, and a policy document is a specification —
**a server that diverges from one of these is defective, and the divergence is
work, not a variation.**

Each policy document therefore ends with what currently conforms and what does
not. That list is the work, and it is kept in the document rather than in issues
so that the rule and the exceptions to it cannot drift apart.

This is about **what a server has to be**. How the work of building one is done
is `workflow/`, and how the code inside it is written is `coding-rules/`.

## Documents

- `policy__mcp-tool-surface` — which tools a server has (`describe` and `exec`),
  what a tool publishes about itself, and where the arguments are documented.
- `policy__approval` — why the approval prompt is not a control, and which gate to
  pick for what is behind it.
- `policy__parameterise` — a value that needs deciding and can be read from the
  environment is configuration, not a discussion.
- `policy__criterion-before-detection` — write the shape down before writing the
  check for departures from it.
- `policy__sharpen-over-exempt` — an exemption belongs only where the rule cannot
  know the answer.
