---
whenToUse:
  - Designing new MCP tools
  - Adding new actions to MCP tools
  - Deciding which tool should contain an action
  - Reviewing MCP tool security
---

# MCP Tool Approval Levels

Guidelines for MCP tool approval levels.

## Important Principle

**MCP tools are approved at the tool level (not at the action level)**

In Claude Code, auto-approve settings can be configured per tool. For example, if the `plan` tool is set to auto-approved, all actions within that tool will be automatically approved.

## Design Guidelines

### Actions Requiring User Approval

The following types of actions should be placed in tools that are NOT auto-approved:

- Writing to the file system
- Connecting to external services
- Irreversible operations (such as deletion)
- Operations requiring explicit user decision

### Example: approve tool

The `approve` tool is designed to always require user approval. It's appropriate for placing important actions:

```typescript
// Good: Placed in approve tool (user approval required)
approve(target: "setup_templates")
approve(target: "deletion", task_id: "...")

// Bad: Placed in plan tool (can be auto-approved)
plan(action: "setup_templates")  // May be executed without user approval
```

## Implementation Checklist

When adding new actions:

1. [ ] Does this action require explicit user approval?
2. [ ] Can the target tool be auto-approved?
3. [ ] If approval is needed, place it in the approve tool or an equivalent non-auto-approved tool
