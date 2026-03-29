# Self-Review: Plan Phase

Requirements and examples for submitting plan phase tasks. Verify your submission meets these standards before confirming.

## Most Important: User Collaboration

**Plan phase is for discussion with the user.**

You MUST:
1. **Raise unclear points** - What's ambiguous in the request?
2. **State concerns** - Why might this approach not work?
3. **Provide rationale** - Why do you believe this plan is correct?

Do NOT proceed silently with assumptions. This phase exists to align with the user BEFORE doing work.

---

## Required Elements

1. **What to do** - Planned actions/investigations
2. **Why this approach** - Rationale with evidence
3. **Success criteria** - What indicates completion
4. **Unclear points** - Questions for the user (REQUIRED)
5. **Concerns** - Potential issues with the approach (REQUIRED)
6. **findings** - What you discovered
7. **sources** - Files, URLs, commands used

---

## Output Structure

### Unclear Points (CRITICAL)

```
## Unclear Points

1. **Scope ambiguity**: "commonization" means sharing code? Or just config?
   - If code: Need new shared package?
   - If config: Just move to root?

2. **Priority unclear**: Which commonization is most valuable?
   - User preference needed before proceeding

3. **Breaking changes**: Is backward compatibility required?
```

### Concerns (CRITICAL)

```
## Concerns

1. **This approach may not work because:**
   - pnpm workspace hoisting might conflict with per-package deps
   - Evidence: Found issue in pnpm docs about peer dependencies

2. **Alternative to consider:**
   - Instead of shared package, use tsconfig paths
   - Simpler, no publish needed

3. **Risk if we proceed:**
   - Changing package.json scripts may break CI
   - Need to check .github/workflows first
```

### What to Do

```
## What to Do

1. Investigate existing shared patterns in monorepo
2. Check pnpm workspace configuration
3. Identify candidates for commonization
```

### Why This Approach (with rationale)

```
## Why This Approach

1. Start with investigation (not implementation)
   - Rationale: Don't know current state yet
   - Evidence: No shared package exists currently

2. Check pnpm config first
   - Rationale: Workspace settings affect all solutions
   - Evidence: pnpm-workspace.yaml exists but minimal
```

### Success Criteria

```
## Success Criteria

Research is complete when:
- [ ] All packages analyzed for common patterns
- [ ] pnpm workspace capabilities documented
- [ ] Recommendation ready with pros/cons
- [ ] Unclear points resolved with user
```

---

## NG Examples

- **No unclear points:** `output_what: "Investigate and implement"` - What exactly? User's intent is not clarified!
- **No concerns:** `output_why: "This is the standard approach"` - What if it doesn't fit this project?
- **Proceeding with assumptions:** `output_what: "Create shared package"` - Did user want this? Did you ask?
- **No rationale:** `output_why: "Because it's better"` - Why? Evidence?

---

## OK Examples

Complete with unclear points and concerns:

```
output_what: |
  ## What to Do

  1. Analyze all 4 packages for common patterns
  2. Check pnpm workspace configuration options
  3. Document findings with specific recommendations

  ## Unclear Points (Need User Input)

  1. **Definition of scope**:
     - Option A: Shared npm package
     - Option B: Just shared config (tsconfig, eslint)
     - Option C: Both
     - Which do you prefer?

  2. **Scope of changes**:
     - All packages, or start with subset?
     - Breaking changes acceptable?

  ## Concerns

  1. **Shared package might be overkill:**
     - Only 2 shared dependencies currently
     - Maintenance overhead vs benefit unclear
     - Suggest: Start with config only (Option B)

output_why: |
  ## Why This Approach

  1. Investigation before action:
     - Rationale: Need full picture before recommending
     - Evidence: Found multiple packages with different maturity levels

  2. User input required:
     - Rationale: Scope is ambiguous
     - Multiple valid interpretations exist

findings: |
  Initial analysis:
  - tsconfig.json: Already shared via tsconfig.base.json
  - ESLint: Already shared via root config
  - Dependencies: Common deps in all packages
  - vitest: Similar but intentionally different thresholds

sources:
  - packages/*/package.json
  - packages/*/tsconfig.json
  - pnpm-workspace.yaml
```
