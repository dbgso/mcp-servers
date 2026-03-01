# Draft Workflow Specification

State machine for draft approval process.

## State Diagram

```mermaid
stateDiagram-v2
    [*] --> editing
    
    editing --> self_review: 🤖 add/update
    self_review --> user_reviewing: 🤖 approve with notes
    user_reviewing --> pending_approval: 👤 user confirms
    pending_approval --> applied: 👤 user provides token
    applied --> [*]
    
    self_review --> self_review: 🤖 update
    user_reviewing --> self_review: 🤖 update
    pending_approval --> self_review: 🤖 update
```

**Legend:** 🤖 = AI action, 👤 = User permission required

## Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    participant AI
    participant Tool as draft tool
    participant File as _mcp_drafts/
    participant Memory as Workflow State
    participant User

    rect rgb(240, 248, 255)
        Note over AI,Memory: Phase 1: Create Draft
        AI->>+Tool: add(id, content)
        Tool->>File: create draft file
        Tool->>Memory: state = self_review
        Tool-->>-AI: Draft created
    end

    rect rgb(255, 250, 240)
        Note over AI,Memory: Phase 2: Self Review
        AI->>+Tool: approve(notes)
        Tool->>Memory: state = user_reviewing
        Tool-->>-AI: Explain to user
    end

    rect rgb(240, 255, 240)
        Note over AI,User: Phase 3: User Review
        activate AI
        AI->>User: Explains content
        User-->>AI: Confirms understanding
        deactivate AI
        
        AI->>+Tool: approve(confirmed)
        Tool->>Memory: state = pending_approval
        Tool->>User: Desktop notification with token
        Tool-->>-AI: Show diff/summary
    end

    rect rgb(255, 240, 245)
        Note over User,Memory: Phase 4: Final Approval
        User-->>AI: Provides token
        
        AI->>+Tool: approve(token)
        Tool->>Memory: validate token
        Tool->>File: move to docs/
        Tool->>Memory: state = applied
        Tool-->>-AI: Success
    end
```

## States

| State | Description |
|-------|-------------|
| `editing` | Initial state, draft is being created/edited |
| `self_review` | AI must review content before explaining |
| `user_reviewing` | AI must explain to user in own words |
| `pending_approval` | Waiting for user's approval token |
| `applied` | Draft promoted to confirmed doc |

## Transitions

### Forward (AI actions)

| From | To | Trigger | Actor |
|------|----|---------|-------|
| editing | self_review | `add` / `update` | 🤖 AI |
| self_review | user_reviewing | `approve(notes)` | 🤖 AI |

### Forward (User permission)

| From | To | Trigger | Actor |
|------|----|---------|-------|
| user_reviewing | pending_approval | `approve(confirmed: true)` | 👤 User confirms AI's explanation |
| pending_approval | applied | `approve(approvalToken)` | 👤 User provides token |

### Reset (AI actions)

| From | To | Trigger | Actor |
|------|----|---------|-------|
| self_review | self_review | `update` | 🤖 AI |
| user_reviewing | self_review | `update` | 🤖 AI |
| pending_approval | self_review | `update` | 🤖 AI |

## Constraints

- Content is NOT shown at `user_reviewing` state
- Diff/summary shown only after `confirmed: true`
- Token validation required before `applied`
- Content update resets workflow to `self_review`

See `design__approval-flow` for rationale.
