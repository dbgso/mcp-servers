# kroki-mcp

## 0.1.1

### Patch Changes

- 5dcc941: Ship a bundled binary. The published package is now a single file with
  `mcp-shared` inlined, so installing it no longer depends on a workspace package
  that is not on the registry. `zod-to-json-schema`, which nothing imported, is
  gone from the dependency list.
