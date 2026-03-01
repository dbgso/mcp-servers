# Self-Review: Do Phase

Requirements and examples for submitting do (implementation) phase tasks. Verify your submission meets these standards before confirming.

## Required Elements

1. **Overall approach** - High-level implementation strategy
2. **Planned changes** - Add/Modify/Delete items with code examples
3. **Impact scope** - Files and modules affected
4. **design_decisions** - Why this implementation approach
5. **Verification plan** - How to verify the changes work

## Output Structure

### output_what (Overall Approach + Planned Changes)

Start with high-level strategy, then show specifics:

```
## Overall Approach

Add self_review as intermediate status between in_progress and pending_review.
AI must explicitly confirm before task goes to user review.

Key principle: Minimal changes to existing handlers by auto-converting status in updateStatus.

## Planned Changes

### Add
- New `confirmSelfReview` method in plan-reader.ts
  \`\`\`typescript
  async confirmSelfReview(id: string): Promise<{ success: boolean; error?: string }> {
    const task = await this.getTask(id);
    if (task?.status !== "self_review") {
      return { success: false, error: "Task not in self_review" };
    }
    // ... update to pending_review
  }
  \`\`\`

- New `confirm-handler.ts`
  \`\`\`typescript
  export class ConfirmHandler implements PlanActionHandler {
    readonly action = "confirm";
    async execute(params): Promise<ToolResult> {
      // validate and call confirmSelfReview
    }
  }
  \`\`\`

### Modify
- types/index.ts: Add self_review to TaskStatus
  \`\`\`diff
  - export type TaskStatus = "pending" | "in_progress" | "pending_review" | ...
  + export type TaskStatus = "pending" | "in_progress" | "self_review" | "pending_review" | ...
  \`\`\`

### Delete
- (none for this task)
```

### output_why (Design Decisions)

Explain architectural choices:
```
## Design Decisions

1. **Auto-conversion in updateStatus (not in each handler)**
   - Single point of control
   - Existing handlers don't need modification
   - Easy to change behavior later

2. **Separate ConfirmHandler (not flag on submit)**
   - Explicit action = clear audit trail
   - Can add confirm-specific validation later
   - Follows existing handler pattern
```

### output_how (Verification Plan)

```
## Verification Plan

1. Unit tests pass: `pnpm test`
2. Type check: `pnpm exec tsc --noEmit`
3. New tests for confirmSelfReview
4. Manual workflow test: submit -> self_review -> confirm -> pending_review
```

## Impact Scope

```
**Files:**
- src/services/plan-reader.ts (+25 lines)
- src/types/index.ts (+1 status)
- src/tools/plan/handlers/confirm-handler.ts (new, ~50 lines)

**Modules affected:**
- Plan tool state machine
- Status validation in all submit handlers

**External impact:**
- None (backward compatible)
```

## NG Examples

- **Missing overall approach:** Just listing changes without explaining strategy
- **No code examples:** `### Modify - Update types/index.ts to add new status` - What does the change look like?
- **Vague changes:** `output_what: "Update the handler to support new workflow"`

## OK Examples

Complete with approach + code:
```
output_what: |
  ## Overall Approach

  Implement self-review workflow by adding intermediate status.
  Strategy: Intercept at updateStatus level to minimize handler changes.

  ## Planned Changes

  ### Add
  - `confirmSelfReview(id)` in plan-reader.ts:
    \`\`\`typescript
    async confirmSelfReview(id: string) {
      const task = await this.getTask(id);
      if (task?.status !== "self_review") {
        return { success: false, error: `Not in self_review: ${task?.status}` };
      }
      await this.updateTaskStatus(id, "pending_review");
      return { success: true };
    }
    \`\`\`

  ### Modify
  - plan-reader.ts updateStatus:
    \`\`\`diff
      async updateStatus({ id, status, ... }) {
    +   // Auto-convert completed to self_review
    +   const actualStatus = status === "completed" ? "self_review" : status;
        ...
      }
    \`\`\`

output_why: |
  1. Auto-conversion at updateStatus:
     - All submit handlers automatically get self_review
     - No need to modify each submit handler

  2. Explicit confirm action:
     - Clear separation: AI review -> User review
     - Auditable: Can track when AI confirmed

design_decisions: Same as output_why above
```
