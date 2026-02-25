---
whenToUse:
  - Designing new MCP tools
  - Structuring MCP tool operations
  - Deciding tool separation boundaries
  - Reviewing MCP architecture
---

# MCP Tool Design Principles

Design principles for MCP tools.

## Basic Structure: Describe + Execute

Each tool should have the following two operations as its basic structure:

1. **Describe** - Explanation/confirmation of operation content (read-only)
2. **Execute** - Actual operation execution (involves changes)

## Tool Separation Criteria: Auto-Execution Permission

Tools should be separated based on "whether auto-execution can be permitted to AI."

### Auto-Execution OK (Can be added to allow list)
- Read-only operations
- Operations with limited side effects
- Reversible operations

Examples: `help`, `plan`, `draft`

### Auto-Execution NG (User confirmation required)
- Approval/confirmation operations
- Irreversible changes
- Operations with external impact

Examples: `approve`, `apply`

## Design Example

```
plan tool (Auto-execution OK)
├── list    - Display task list
├── read    - Display task details
├── status  - Change status
├── feedback - Display feedback
└── interpret - Add AI interpretation

approve tool (User confirmation required)
└── approve - Task/feedback approval
```

## Why This Design

1. **Safety**: User confirmation is required for important operations
2. **Efficiency**: Daily operations are accelerated with auto-execution
3. **Transparency**: Permission level is clear from the tool name
