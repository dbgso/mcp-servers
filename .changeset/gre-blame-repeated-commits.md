---
"git-repo-explorer-mcp": patch
---

`blame` gives every line the author and date of its own commit.

`git blame --porcelain` prints a commit's author and date only the first time that commit appears. When a later part of the file came from the same commit, `blame` reported whatever author and date it had read last, which belonged to a different commit. Author and date are now remembered per commit.
