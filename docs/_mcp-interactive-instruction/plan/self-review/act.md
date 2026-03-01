# Self-Review: Act Phase

Requirements and examples for submitting act (feedback response) phase tasks. Verify your submission meets these standards before confirming.

## Required Elements

1. **feedback_addressed** - What feedback was addressed and how
2. **Knowledge proposal** - Suggest adding learned knowledge to help docs

## Evidence Format

**For feedback response:**
```
**Addressed feedback from user review:**

1. **"Add more specific error messages"**
   - Modified error-handler.ts:45-60
   - Added context: task ID, current status, expected status

2. **"Test coverage too low"**
   - Added 5 new tests in plan-reader.test.ts:890-950
   - Coverage increased from 85% to 95%
```

**For iteration improvements:**
```
**Applied lessons from check phase:**

1. Changed validation order (validate phase before base params)
   - Reduces unnecessary processing on phase mismatch
   - See check-submit-handler.ts:92-106

2. Added early return for non-existent tasks
   - Prevents null reference errors
   - See base-submit-handler.ts:106-112
```

## Knowledge Proposal (Required)

At the end of act phase, you MUST ask the user:

```
## Knowledge Learned

During this task, I learned:
- [Knowledge point 1]
- [Knowledge point 2]

**Propose adding to help docs?**
- [ ] Yes - Create draft in `coding-rules/[topic]` or appropriate category
- [ ] No - This is task-specific, not reusable

Which would you like?
```

**Examples of knowledge worth adding:**
- New coding patterns or conventions discovered
- Error patterns to avoid
- Testing requirements learned
- Workflow improvements identified

**Examples NOT worth adding:**
- One-time bug fixes
- Task-specific implementation details
- Temporary workarounds

## NG Examples

- **Vague response:** `feedback_addressed: "Fixed the issues mentioned in the review"`
- **Missing knowledge proposal:** `feedback_addressed: "Updated error handling as requested"` - No proposal to add learned knowledge to help docs

## OK Examples

Specific feedback addressed with knowledge proposal:
```
feedback_addressed: |
  **User feedback: "Error message doesn't show which task failed"**

  Before (base-submit-handler.ts:82):
  \`\`\`typescript
  return { text: "Validation failed" };
  \`\`\`

  After (base-submit-handler.ts:82-86):
  \`\`\`typescript
  return {
    text: `Validation failed for task "${id}": ${errors.join(", ")}`
  };
  \`\`\`

  **Verified fix:**
  \`\`\`
  $ plan(action: "submit_check", id: "invalid", ...)
  Error: Validation failed for task "invalid": id must end with __check
  \`\`\`

---

## Knowledge Learned

During this task, I learned:
- Error messages should always include context (task ID, current state)
- User-facing messages need actionable information

**Propose adding to help docs?**
- [x] Yes - Create draft in `coding-rules/error-messages`
- [ ] No - This is task-specific

Would you like me to create this draft?
```
