# AST Tool Evolution Policy

Continuously enhance AST tools (ast-typescript-mcp, ast-file-mcp) through MCP server development.

## Core Philosophy

**Build the tools we use ourselves**

1. When you feel "this tool would be useful" during MCP server development, add it to ast-*-mcp immediately
2. Discover improvements while using in actual development -> feedback loop
3. Improve quality through dogfooding

## Criteria for Adding Tools

### Cases to Add
- Performed the same operation manually 3+ times
- Build -> check errors -> fix cycle is slow
- Understanding code takes too long (type expansion, reference tracking, etc.)

### Examples
| Issue | Tool |
|-------|------|
| Want to check type errors before building | `type_check` |
| Adding imports is tedious | `auto_import` |
| Want to understand complex types | `inline_type` |

## Development Flow

1. **Discover Issue**: Feel inconvenience during MCP development
2. **Add to Plan Immediately**: Create a task before forgetting
3. **Prioritize**: Need now vs. implement later
4. **Implement -> Use Immediately**: Use it yourself right after building
5. **Improve**: Fix issues noticed during use

## References

- `ast-typescript-mcp`: AST tools for TypeScript
- `ast-file-mcp`: AST tools for Markdown/AsciiDoc
