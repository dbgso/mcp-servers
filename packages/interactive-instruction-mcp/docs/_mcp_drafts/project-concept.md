# Project Concept

MCP Interactive Instruction is a Model Context Protocol (MCP) server that provides AI assistants with interactive access to markdown documentation.

## Purpose

This project enables AI agents to:
- Browse and read confirmed documentation
- Create and manage temporary drafts autonomously
- Promote drafts to confirmed documentation (with user approval)

## Key Features

- **Documentation Management**: Organize markdown files in a hierarchical structure
- **Draft Workflow**: AI can freely create/update drafts without permission
- **Apply Workflow**: Drafts require user approval before becoming confirmed docs
- **Caching**: Efficient caching for directory structures and content

## Design Philosophy

1. **AI Autonomy**: Let AI record learned information immediately without friction
2. **User Control**: Require explicit approval for permanent documentation changes
3. **Organization**: One topic per file, use directory hierarchy for related topics