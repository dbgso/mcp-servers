---
whenToUse:
  - Writing new code
  - Refactoring existing code
  - Reviewing code quality
  - Learning project coding standards
---

# Coding Standards

A collection of fundamental rules for writing maintainable and readable code.

## Basic Principles

### DRY (Don't Repeat Yourself)
- Don't repeat the same code
- Extract common logic into functions/modules

### KISS (Keep It Simple, Stupid)
- Strive for simple implementations
- Break down complex logic to make it easier to understand

### YAGNI (You Aren't Gonna Need It)
- Don't implement until it's needed
- Avoid over-engineering based on future assumptions

## Naming Conventions

- Use meaningful names (specific names rather than `data` or `temp`)
- Follow consistent naming conventions (camelCase, snake_case, etc.)
- Avoid abbreviations; prioritize readability
- Start function names with verbs (`getUserName`, `calculateTotal`)
- Start boolean values with `is`, `has`, `can`

## Function Design

- Single Responsibility Principle (one function does one thing)
- Keep functions short (guideline: within 20-30 lines)
- Keep arguments minimal (ideally 3 or fewer)
- Minimize side effects

## Error Handling

- Detect errors early and handle them appropriately
- Include specific and useful information in error messages
- Don't forget to check for null and undefined

## Comments

- Express in code what can be expressed in code
- Write comments that explain "why" (not "what")
- Delete or update outdated comments

## Testing

- Write testable code
- Test boundary values and edge cases
- Make test names clearly describe what is being tested
