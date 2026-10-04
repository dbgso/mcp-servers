---
"mcp-interactive-instruction": patch
---

`list` and `graph` accept their boolean and number arguments as strings.

`instruction` publishes no argument types on purpose -- `describe` is where they are written down -- so a client has nothing to serialise against and can send `recursive: true` as `"true"`. The schema then rejected `list(recursive: true)`, the first call CLAUDE.md asks for, while it was being made exactly as `describe` shows it. `recursive`, `drafts` and `includeUnlinked` now take `"true"` and `"false"`, and `depth` and `spacing` take a plain decimal string such as `"2"`. Nothing looser: `"yes"`, `"1"` for a boolean, or `"two"` is still an error.
