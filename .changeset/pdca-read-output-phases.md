---
"interactive-pdca-mcp": patch
---

`plan(action: "read_output")` shows the phase sections again (Findings / Sources, Changes / Design Decisions, Test Target / Test Results / Coverage, Changes / Feedback Addressed).

It matched phase names nothing writes any more (research / implement / verify / fix), so for every real plan / do / check / act output it printed only what / why / how. It now shares one definition of the phase sections with PENDING_REVIEW.md. `plan(action: "graph")` also shows `self_review` tasks with their own icon and colour instead of as pending, matching GRAPH.md.

Feedback created within the same millisecond no longer gets the same id. Before, the second entry overwrote the first.
