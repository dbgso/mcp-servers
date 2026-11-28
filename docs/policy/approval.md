---
description: Do not rely on the AI tool's approval prompt. A human approves anyway, so what stops a mutation has to be something the server itself cannot be talked out of.
whenToUse:
  - Adding an action that writes, deletes or calls out
  - Deciding which tool an action belongs in
  - Choosing a gate for a mutation
  - Reviewing whether a server's safety story holds
---

# Approval

**The approval prompt is not a control.** Claude Code and every tool like it can
allow-list a tool, and a human faced with a prompt on every operation approves it
— not carelessly, but because that is what the prompt trains. A design whose
safety rests on the click has no safety.

So: **what stops a mutation is something the server offers that cannot be got
round.** Not a prompt the caller can be granted permission to skip.

## The tiers, and which one to pick

**Unbypassable.** The tool boundary itself. An action that must not happen
without a person lives in a tool that is not on anyone's allow list, and the
separation is what enforces it — see `coding-rules__mcp-tool-approval`, which is
this principle expressed as tool layout. A token minted for one change and
validated against that change is the same idea inside one tool:
`mcp-shared`'s approval primitive does that, and it makes a swapped target
*impossible* rather than visible.

**Disclosure, for things that are not critical.** The deliberation gate in
`interactive-instruction-mcp` is deliberately weaker: an operation is disclosed
with a tool-computed account of the change plus the caller's own explanation, and
only an identical repeat goes through. A run is keyed on the operation, the change
and the wording, so a repeat that quietly altered any of them is refused from the
first attempt.

**Be exact about what that gives up.** An agent that has been refused can open a
fresh run for the swapped change and push it through at the cost of one more
disclosure, and nothing verifies that a human read anything. What carries the risk
instead is reversibility: a delete is refused twice, names the backlinks it would
break, and then removes a file the corpus's version control has. That trade is
only acceptable because the thing being protected is documentation.

**So the gate is chosen by what is behind it, not by taste.** If an uncooperative
agent getting through would be genuinely damaging, disclosure is the wrong gate
and the token strategy is still there to install.

## What this rules out

- Relying on `approve` being outside an allow list *and nothing else*, when the
  action is irreversible.
- Reading a token out of arguments supplied after a human handed it over, which is
  how an approval for "create a new note" came to be spendable on replacing any
  promoted document.
- Any gate whose only evidence is that a prompt appeared.
