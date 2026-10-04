---
"git-repo-explorer-mcp": patch
---

`grep` searches for a pattern that starts with `-`.

The pattern was handed to `git grep` as a bare argument, so a pattern such as `-foo` was read as an option and the call failed with "unknown switch". It is now passed with `-e`.
