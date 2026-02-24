---
description: Use AST tools for TypeScript coding (investigation and modification). Report issues/missing features.
whenToUse:
  - TypeScript code investigation
  - Function signature refactoring
  - Finding all references to a symbol
  - Large-scale code changes (3+ locations)
  - Understanding call graphs or dependencies
---

# AST Tool Usage for TypeScript Coding

When coding TypeScript (investigation, modification, refactoring), actively use AST tools.

## Related

- **`coding__ts-codemod-refactoring`**: Detailed guide for large-scale refactoring with `ts_codemod`

## Investigation

- **Code structure overview**: `ts_structure_read` to list functions, classes, types
- **Call relationships**: `call_graph` to visualize function call hierarchy
- **Dependency analysis**: `dependency_graph` to understand module dependencies
- **Reference lookup**: `find_references` to enumerate symbol usage locations
- **Definition jump**: `go_to_definition` to locate definitions
- **Pattern search**: `query_ast`, `ts_find_blocks` to search for specific code patterns

## Modification

- **Function signature changes**: `transform_signature`, `transform_call_site`
- **Symbol renaming**: `rename_symbol`
- **Dead code removal**: `ts_remove_nodes`, `ts_remove_unused_imports`
- **Type extraction**: `extract_interface`, `extract_common_interface`
- **Large-scale refactoring**: `ts_codemod` (see `coding__ts-codemod-refactoring`)

## Benefits

1. **Accuracy**: Syntax-aware changes vs text replacement
2. **Completeness**: Update all reference locations without missing any
3. **Safety**: Prevent syntax errors
4. **Efficiency**: Faster than manual search and replace

## Feedback Required

**If you find improvements or missing features in AST tools, always provide feedback.**

Report when:
- Tool did not work as expected
- Needed functionality was missing
- Error messages were unclear
- Performance issues occurred

Feedback method:
```
draft(action: "add", id: "feedback__ast-tool-<issue>", content: "...")
```