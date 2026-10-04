---
"git-repo-explorer-mcp": patch
---

`pr_comments` works on pull requests with more than one page of reviews or comments.

`gh api --paginate --jq` runs the filter on each page separately. The filter wrapped each page in a JSON array, so a PR with more than one page (over 30 reviews or review comments) printed several arrays one after another, and the call failed with a JSON parse error. The filter now prints one object per line, and every page is read.
