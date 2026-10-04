---
"mcp-shared-db-codegen": patch
"db-codegen-mcp": patch
---

db-codegen-mcp now honours `ssl-mode` / `sslmode` on a MySQL URL, so a connection that asks for TLS gets it.

Schema introspection opened its MySQL connection with its own copy of the URL parsing, which understood only `?ssl=true`. A URL with `?ssl-mode=REQUIRED`, or `DBGEN_PARAMS=sslmode=require` as the README shows, connected in plain text without saying so. Introspection now opens MySQL and PostgreSQL connections with the same clients db-read-mcp uses, so both servers read a connection URL the same way.
