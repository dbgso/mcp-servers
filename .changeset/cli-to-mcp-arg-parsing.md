---
"cli-to-mcp": patch
---

`cli_execute` splits a string `args` the way a POSIX shell does.

An escaped character kept its backslash, so `hello\ world` reached the command as `hello\ world` instead of `hello world`, and an escaped backslash went on to escape the character after it. An empty quoted argument (`""` or `''`) was dropped, which shifted every argument after it. Tabs and newlines did not separate arguments. Now a backslash outside quotes makes the next character literal and is removed, inside double quotes a backslash escapes only a double quote or another backslash, single quotes keep everything literally, an empty quoted string is passed on as an empty argument, and any whitespace separates arguments.
