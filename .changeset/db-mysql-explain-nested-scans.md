---
"mcp-shared-db-mysql": patch
"db-read-mcp": patch
---

The MySQL auto-EXPLAIN guard now sees scans nested at any depth in the plan.

The plan walk looked into ORDER BY / GROUP BY / DISTINCT wrappers only one level deep and did not look into join entries at all. A `SELECT ... GROUP BY ... ORDER BY ...` puts the table scan under `grouping_operation` inside `ordering_operation`, so the walk found no scan and reported no row estimate, and the guard let a full scan of a large table through. A subquery attached to a joined table and the query that fills a derived table were missed the same way. All of these are now included when the widest scan is chosen.
