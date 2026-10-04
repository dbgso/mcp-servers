---
"mcp-shared-db-core": patch
"mcp-shared-db-codegen": patch
"db-codegen-mcp": patch
---

Generated metadata and the `selectable-fields` validator now read native column types from one table, so they no longer disagree.

The validator's PII over-apply check kept its own type patterns. It read `tinyint(1) unsigned` as a number while codegen wrote it as a boolean, so a redacted flag of that type got no `pii_on_boolean` warning. It also did not know MySQL `year` (now a date/time value) or `bit` (now an integer). Codegen now also reads `timestamp(3) with time zone` as a date/time and an `enum` whose values contain `)` as an enum.
