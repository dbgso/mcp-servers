---
whenToUse:
  - Getting started with project coding standards
  - Finding relevant coding rule documents
  - Understanding project quality requirements
  - Onboarding new team members
---

# Coding Standards Overview

This document provides an overview of project-wide coding standards and references to detailed documents.

## Basic Principles

1. **Readability**: Code is read more often than it is written. Prioritize readability.
2. **Maintainability**: Design for ease of future changes.
3. **Consistency**: Maintain a unified style across the project.
4. **Testability**: Write code that is easy to test.

## Standards List

### Language/Framework Specific

| Document | Description |
|----------|-------------|
| [typescript](coding-rules__typescript) | TypeScript-specific standards |

### Code Style

| Document | Description |
|----------|-------------|
| [general](coding-rules__general) | General coding rules |
| [style](coding-rules__style) | DRY principle and code sharing |
| [english-comments](coding-rules__english-comments) | Write comments in English |
| [if-statement-comments](coding-rules__if-statement-comments) | Rules for adding comments to if statements |

### Design Patterns

| Document | Description |
|----------|-------------|
| [early-return](coding-rules__early-return) | Use early returns |
| [polymorphism](coding-rules__polymorphism) | Leverage polymorphism |
| [handler-pattern](coding-rules__handler-pattern) | Handler pattern |
| [ternary-testability](coding-rules__ternary-testability) | Ternary operators and testability |

### MCP Specific

| Document | Description |
|----------|-------------|
| [mcp-tool-design](coding-rules__mcp-tool-design) | MCP tool design principles |
| [mcp-tool-approval](coding-rules__mcp-tool-approval) | Approval level guidelines |
| [mcp-tool-testing](coding-rules__mcp-tool-testing) | MCP tool testing process |
| [mcp-tool-help-pattern](coding__mcp-tool-help-pattern) | Help parameter implementation |

### Quality Assurance

| Document | Description |
|----------|-------------|
| [test-coverage](coding-rules__test-coverage) | 95%+ test coverage required |

## Quick Reference

### Requirements

- Maintain test coverage of **95% or higher**
- Write comments in **English**
- Use **early returns** (reduce nesting)
- Leverage **polymorphism** (reduce switch/if statements)
- Implement **help parameter** for MCP tools

### Prohibited

- Use of `any` type (consider `unknown` if unavoidable)
- Complex conditionals without comments
- Merging code without tests
- Releasing with coverage below 95%

## Adding New Rules

When adding new coding rules:

1. Create a new document under `docs/coding-rules/`
2. Add it to the relevant section in this overview document
3. Notify the team
