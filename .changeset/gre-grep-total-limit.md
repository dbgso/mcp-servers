---
"git-repo-explorer-mcp": patch
---

`grep` returns at most `max_count` matches in total, and `truncated` tells the truth.

`max_count` was handed to `git grep --max-count`, which counts per file, so a search over many files returned far more matches than asked for. `truncated` was set whenever the number returned reached the limit, so it was `true` when exactly that many matches existed and `false` when files had been cut short. The limit now applies to the whole result, and `truncated` is `true` only when matches were left out.
