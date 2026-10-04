---
"mcp-shared-db": patch
"db-read-mcp": patch
---

A column marked `select: "exclude"` can no longer be used as a filter.

`"exclude"` means the column is rejected from queries entirely. The read operations only checked that a column was listed in `selectable-fields`, so `get_by_index`, `get_by_fk`, `get_by_date_range` and `json_search` still accepted an excluded column as the filter. The value never appeared in the output, but whether rows came back told the caller whether a row with that hidden value exists. These operations now refuse an excluded column like an unlisted one, leave it out of `allowedColumns`, and no longer select excluded columns from the database at all.
