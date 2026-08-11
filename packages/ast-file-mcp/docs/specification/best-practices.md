# Best Practices

## Workflow: Understanding a New Codebase

1. **Start with entry point**
   ```json
   { "tool": "crawl", "file_path": "/project/README.md", "max_depth": 3 }
   ```
   → Get documentation map from README

2. **Get overview of docs directory**
   ```json
   { "tool": "read_directory", "directory": "/project/docs", "limit": 20 }
   ```
   → See all docs with their headings

3. **Drill down to specific section**
   ```json
   { "tool": "ast_read", "file_path": "/project/docs/api.md", "heading": "Authentication" }
   ```
   → Read only the relevant section

## Workflow: Documentation Maintenance

1. **Check for broken links**
   ```json
   { "tool": "link_check", "file_path": "/project/docs/*.md" }
   ```

2. **Compare before/after refactoring**
   ```json
   { "tool": "diff_structure", "file_path_a": "/old/README.md", "file_path_b": "/new/README.md" }
   ```

3. **Generate TOC for large doc**
   ```json
   { "tool": "toc_generate", "file_path": "/project/docs/guide.md", "depth": 2 }
   ```

## Tool Selection Guide

| Goal | Tool | Why |
|------|------|-----|
| Understand doc structure | `ast_read` + `query: "headings"` | Fast overview |
| Find all external links | `ast_read` + `query: "links"` | Filter by URL pattern |
| Navigate to linked doc | `go_to_definition` | Follow reference |
| Map entire documentation | `crawl` | Recursive discovery |
| Bulk analysis | `read_directory` | No link-following needed |
| Validate links | `link_check` | Before publishing |
| Track doc changes | `diff_structure` | PR review |

## Anti-Patterns

### ❌ Reading full AST when you only need headings
```json
// Bad: Returns entire AST
{ "tool": "ast_read", "file_path": "large-doc.md" }

// Good: Returns only headings
{ "tool": "ast_read", "file_path": "large-doc.md", "query": "headings" }
```

### ❌ Reading multiple files without pagination
```json
// Bad: May return huge response
{ "tool": "read_directory", "directory": "/docs" }

// Good: Paginate large directories
{ "tool": "read_directory", "directory": "/docs", "limit": 20 }
```

### ❌ Using crawl when read_directory is sufficient
```json
// Bad: Follows all links (slow, may find unrelated files)
{ "tool": "crawl", "file_path": "/docs/index.md" }

// Good: Direct directory scan
{ "tool": "read_directory", "directory": "/docs", "pattern": "*.md" }
```

## Token Efficiency Tips

1. **Use queries** - `headings`, `links`, `code_blocks` instead of `full`
2. **Use heading parameter** - Read specific section, not entire file
3. **Use pagination** - `limit` and `cursor` for large results
4. **Use depth filter** - `depth: 2` for TOC/headings to skip deep nesting
