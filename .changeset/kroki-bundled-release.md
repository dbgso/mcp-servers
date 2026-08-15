---
"kroki-mcp": patch
---

Ship a bundled binary. The published package is now a single file with
`mcp-shared` inlined, so installing it no longer depends on a workspace package
that is not on the registry. `zod-to-json-schema`, which nothing imported, is
gone from the dependency list.
