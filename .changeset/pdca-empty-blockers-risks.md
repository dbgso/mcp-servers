---
"interactive-pdca-mcp": patch
---

Every view of a task output now shows its Blockers and Risks sections the same way, including when they are empty: a `- None` bullet.

`plan(action: "read_output")` used to leave an empty Blockers or Risks section out altogether, and the `submit_review` response printed a bare `None`, while PENDING_REVIEW.md printed `- None`. All three now print `- None`, so "there were none" is not mistaken for "not shown here".
