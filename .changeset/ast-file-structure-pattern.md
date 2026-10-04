---
"ast-file-mcp": patch
---

`structure_analysis` on a directory refuses a `pattern` no handler reads (such as `*.txt`) with "Unsupported file pattern", as `read_directory` and `topic_index` already did, instead of reporting an empty directory.
