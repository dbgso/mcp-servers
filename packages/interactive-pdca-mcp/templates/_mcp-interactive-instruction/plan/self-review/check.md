# Self-Review: Check Phase

Requirements and examples for submitting check (verification) phase tasks. Verify your submission meets these standards before confirming.

## Required Elements

1. **test_target** - What was verified
2. **test_results** - Results with exact evidence
3. **coverage** - How thoroughly verified
4. **Related references** - Documents and code details consulted

## Types of Check Tasks

### 1. Implementation Tasks (Code Changes)

**Verify:**
- Tests pass with actual output
- Coverage numbers (if configured)
- TypeScript/lint checks

### 2. Research/Investigation Tasks

**Verify:**
- Findings are accurate (re-check sources)
- Related documents consulted
- Code details match claims

### 3. Documentation Tasks

**Verify:**
- Content is accurate
- Links work
- Examples are correct

---

## Evidence Format

### For Test Execution (jest/vitest/etc.)

**MUST include:**
- Exact test command executed
- Actual output showing pass/fail
- Coverage numbers (if project has coverage configured)

```
**Test execution:**
\`\`\`
$ pnpm test
 v src/__tests__/plan-reader.test.ts (69 tests) 307ms
 v src/__tests__/plan-reporter.test.ts (27 tests) 118ms

 Test Files  7 passed (7)
      Tests  224 passed (224)
\`\`\`

**Coverage:**
\`\`\`
$ pnpm test --coverage
 % Stmts | % Branch | % Funcs | % Lines
   99.59 |    98.21 |   99.12 |   99.85
\`\`\`
```

### For Research/Investigation Tasks

**MUST include:**
- Re-verification of key findings
- Related documents consulted
- Code details with file:line references

```
**Re-verified findings:**

1. **Claim: "PDCA created in start-handler only"**
   - Checked start-handler.ts:94-125
   - Grep'd all handlers for "PDCA": only start-handler has creation code
   \`\`\`
   $ grep -rn "addTask.*__plan\|__do\|__check\|__act" src/
   src/tools/plan/handlers/start-handler.ts:98:  await this.planReader.addTask({
   \`\`\`

2. **Claim: "TaskPhase type in base-submit-handler"**
   - Verified at base-submit-handler.ts:29-30
   \`\`\`typescript
   export const TASK_PHASES = ["plan", "do", "check", "act"] as const;
   export type TaskPhase = (typeof TASK_PHASES)[number];
   \`\`\`

**Related documents consulted:**
- coding-rules/state-pattern.md - Confirmed handler pattern matches
- workflow/pdca.md - Verified phase naming convention

**Related code details:**
- start-handler.ts:15-20 - PDCA_PHASES constant definition
- start-handler.ts:94-125 - Subtask creation loop
- types/index.ts:45-52 - TaskStatus type (includes self_review)
```

### For TypeScript/Lint Checks

```
**TypeScript check:**
\`\`\`
$ pnpm exec tsc --noEmit
(no errors)
\`\`\`

**Lint check:**
\`\`\`
$ pnpm exec eslint src --ext .ts
(no output = no errors)
\`\`\`
```

---

## NG Examples

- **Missing command:** `test_results: "All tests passed"` - Show the actual output!
- **No re-verification of findings:** `test_results: "Confirmed the research findings are correct"` - Where? How? Show evidence!
- **Missing related references:** `test_results: "Checked the implementation"` - What documents? What code details?
- **Vague file reference:** `test_results: "Checked the implementation in the handler file"` - Which file? Which lines?

---

## OK Examples

### Implementation Task

```
test_target: Self-review workflow implementation

test_results: |
  **Unit tests:**
  \`\`\`
  $ pnpm test
   Test Files  7 passed (7)
        Tests  224 passed (224)
  \`\`\`

  **Coverage:**
  \`\`\`
  $ pnpm test --coverage
   % Stmts | % Branch | % Funcs | % Lines
     99.59 |    98.21 |   99.12 |   99.85
  \`\`\`

  **TypeScript:**
  \`\`\`
  $ pnpm exec tsc --noEmit
  (no errors)
  \`\`\`

  **Manual verification:**
  \`\`\`
  $ plan(action: "submit_check", ...)
  Status: in_progress -> self_review

  $ plan(action: "confirm", ...)
  Status: self_review -> pending_review
  \`\`\`

coverage: Unit 224 tests (99.59% stmts), Manual 2 scenarios
```

### Research Task

```
test_target: PDCA lazy creation investigation

test_results: |
  **Re-verified key findings:**

  1. PDCA creation location:
     \`\`\`
     $ grep -n "PDCA_PHASES" src/tools/plan/handlers/start-handler.ts
     15:const PDCA_PHASES = [
     94:    for (const phase of PDCA_PHASES) {
     \`\`\`
     Confirmed: Lines 94-125 contain creation loop

  2. add-handler has no PDCA:
     \`\`\`
     $ grep -n "PDCA\|__plan\|__do" src/tools/plan/handlers/add-handler.ts
     66:- PDCA phases: plan, do, check, act  # comment only
     \`\`\`
     Confirmed: No creation code

  **Related documents:**
  - help(id: "workflow/pdca") - Phase naming matches
  - help(id: "coding-rules/handlers") - Handler pattern verified

  **Related code details:**
  - start-handler.ts:15-25 - PDCA_PHASES constant
  - start-handler.ts:94-125 - Creation loop with dependencies
  - base-submit-handler.ts:29-30 - TaskPhase type
  - types/index.ts:45-52 - TaskStatus includes all states

coverage: |
  - 3 key findings re-verified with grep/read
  - 2 related documents consulted
  - 4 code locations documented with line numbers
```
