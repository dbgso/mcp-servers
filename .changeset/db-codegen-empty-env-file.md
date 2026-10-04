---
"db-codegen-mcp": patch
---

`--env-file ""` now stops start-up with "Env file not found", as it already did in db-read-mcp, instead of being ignored. Both servers now share one start-up routine.
