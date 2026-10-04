---
"ast-typescript-mcp": patch
---

`ts_ast` actions accept their boolean, number and array arguments as strings.

`ts_ast` publishes only `action` and `help`, so a client has no type for any other argument and sends it as a string: Claude Code sends `line: 3` as `"3"`, `dry_run: false` as `"false"` and `include: ["**/*.ts"]` as `'["**/*.ts"]'`. Every action that takes a line and column (`hover`, `definition`, `references`, `rename`, ...) therefore failed validation, and a `dry_run: false` could not be expressed. All 68 such arguments across 25 actions now take the string spelling (`"true"`/`"false"`, a plain decimal, a JSON array). Anything looser, such as `"yes"` or `"1e3"`, is still rejected. Where an argument takes a path or a list of paths (`read`, `find_blocks`, `extract_common_interface`), a string holding a JSON array is read as the list.
