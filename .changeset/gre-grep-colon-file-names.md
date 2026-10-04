---
"git-repo-explorer-mcp": patch
---

`grep` reports the right file and line for files whose names contain `:`.

Each match line was split at the first colon after the ref, so a match in `a:1:b.txt` came back as file `a`, line 1, with the rest of the name in the content. `git grep` now runs with `-z`, which ends the file name and line number with NUL, and the output is split on that.
