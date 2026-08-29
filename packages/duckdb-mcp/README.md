# duckdb-mcp

MCP server for querying CSV, TSV, JSON, JSONL and Parquet files with SQL, via
[DuckDB](https://duckdb.org/).

## Why

- **No import step** – Files are queried where they sit. Nothing is loaded into
  a database first
- **Files larger than the context window** – A 200 MB CSV cannot be read into a
  conversation, but `SELECT ... GROUP BY` over it returns a few rows. Schema
  first, aggregate second, rows last
- **JOIN across formats** – Give several files aliases and join a Parquet
  extract against a CSV export in one query
- **Encodings that are not UTF-8** – `encoding` handles the Shift_JIS export
  that would otherwise arrive as mojibake

## Installation

```bash
npm install -g duckdb-mcp
```

## Configuration

```json
{
  "mcpServers": {
    "duckdb-mcp": {
      "command": "npx",
      "args": ["-y", "duckdb-mcp"]
    }
  }
}
```

## Tools

### `duckdb_describe`

Column names, types, row count and detected format. The cheap first call, before
writing SQL against columns whose names are a guess.

| Parameter | Type | Description |
|---|---|---|
| `file_path` | string | Path to the data file |
| `encoding` | string, optional | e.g. `utf-8`, `shift_jis` |

### `duckdb_count`

Counts grouped by one column, largest groups first — the distribution of a
column without writing the `GROUP BY` yourself.

| Parameter | Type | Description |
|---|---|---|
| `file_path` | string | Path to the data file |
| `group_by` | string | Column to group by |
| `top_n` | number, optional | Groups to return, 1–1000 (default 20) |
| `encoding` | string, optional | File encoding |

### `duckdb_query`

Arbitrary SQL.

| Parameter | Type | Description |
|---|---|---|
| `sql` | string | The query. The table is `data` for a single file, or the alias you gave it |
| `file_path` | string, optional | One file, exposed as `data` |
| `files` | array, optional | `{ path, alias, encoding }` entries, for joins |
| `limit` | number, optional | Max rows returned, 1–10000 (default 100) |
| `output_path` | string, optional | Write results to a file instead of returning them |
| `encoding` | string, optional | Default encoding for the files |

`output_path` matters for results too large to return: write them to Parquet or
CSV and query that file in turn.

## Example

```
duckdb_describe(file_path: "orders.csv")
  → order_id BIGINT, customer_id BIGINT, status VARCHAR, total DECIMAL, 2.4M rows

duckdb_count(file_path: "orders.csv", group_by: "status")
  → shipped 1.9M, pending 380K, cancelled 120K

duckdb_query(
  files: [
    { path: "orders.csv",    alias: "o" },
    { path: "customers.parquet", alias: "c" }
  ],
  sql: "SELECT c.region, SUM(o.total) AS revenue
        FROM o JOIN c ON o.customer_id = c.id
        WHERE o.status = 'shipped'
        GROUP BY c.region ORDER BY revenue DESC"
)
```

## License

MIT
