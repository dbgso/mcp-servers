# Draft Approval Workflow

Rules and output formats for approving drafts.

## Workflow Overview

```
editing → self_review → user_reviewing → pending_approval → applied
```

## user_reviewing: Explain to User

### Required Items

1. **File path**: Both full path and relative path
2. **Content summary**: What the draft defines/changes
3. **Path rationale**: Why you chose that path

### Output Format

#### CREATE (new file)

```
File: {full_path} ({relative_path})

This draft creates "{title}".

Content:
- {key point 1}
- {key point 2}
- ...

Path rationale:
- Uses `{prefix}__` because it belongs to {category} category
- {specific naming reason}
```

#### UPDATE (modification)

```
File: {full_path} ({relative_path})

This draft updates "{title}".

Changes:
- {old content 1}
+ {new content 1}

- {old content 2}
+ {new content 2}

Reason: {why this change is needed}
```

## Examples

### CREATE Example

```
File: /path/to/docs/coding-rules/mcp-integration-test.md (coding-rules/mcp-integration-test.md)

This draft creates "MCP Integration Test Rule".

Content:
- Integration tests are mandatory for MCP tool implementations
- Prevents bugs that unit tests alone cannot catch
- 4 test categories: normal flow, state transitions, errors, approval flow

Path rationale:
- Uses `coding-rules/` directory as it's a coding convention
- Named `mcp-integration-test` as it covers MCP integration testing rules
```

### UPDATE Example

```
File: /path/to/docs/coding-rules/dependency-format.md (coding-rules/dependency-format.md)

This draft updates "Dependency Version Format".

Changes:
- "dependencies": { "@modelcontextprotocol/sdk": "^1.26.0" }
+ "dependencies": { "@modelcontextprotocol/sdk": "1.26.0" }

Reason: Caret (^) allows unexpected version upgrades, so changed to fixed version
```
