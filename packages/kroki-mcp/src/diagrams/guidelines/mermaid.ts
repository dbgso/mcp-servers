/**
 * Mermaid detailed guidelines based on official documentation
 * Sources:
 * - https://mermaid.js.org/intro/syntax-reference.html
 * - https://mermaid.ai/open-source/syntax/flowchart.html
 * - https://mermaid.ai/open-source/syntax/sequenceDiagram.html
 */

export const mermaidGuidelines = {
  overview: `Mermaid is a JavaScript-based diagramming tool that renders Markdown-inspired text definitions to create diagrams dynamically.

## Supported Diagram Types (23 total)
- Flowchart, Sequence, Class, State, ER Diagram
- User Journey, Gantt, Pie Chart, Quadrant Chart
- Requirement Diagram, GitGraph, C4 Diagram
- Mindmap, Timeline, ZenUML, Sankey
- XY Chart, Block Diagram, Packet, Kanban
- Architecture, Radar, Treemap

## Basic Structure
All diagrams begin with a type declaration followed by definitions:
\`\`\`mermaid
flowchart TD
    A --> B
\`\`\`

## Comments
Use \`%%\` for line comments (ignored by parser).

## Configuration
- Frontmatter: YAML between \`---\` delimiters
- Directives: \`%%{ init: { ... } }%%\`
- API: \`mermaid.initialize()\`

## Layout Engines
- **Dagre** (default): Good balance of simplicity and clarity
- **ELK**: Advanced options for large/complex diagrams`,

  subDiagrams: {
    flowchart: {
      syntax: `## Flowchart Syntax

### Direction
- \`flowchart TB\` / \`TD\` - Top to Bottom
- \`flowchart BT\` - Bottom to Top
- \`flowchart LR\` - Left to Right
- \`flowchart RL\` - Right to Left

### Node Shapes
\`\`\`mermaid
flowchart LR
    A[Rectangle]
    B(Rounded)
    C([Stadium])
    D[[Subroutine]]
    E[(Database)]
    F((Circle))
    G>Asymmetric]
    H{Diamond}
    I{{Hexagon}}
    J[/Parallelogram/]
    K[\\Parallelogram alt\\]
    L[/Trapezoid\\]
    M[\\Trapezoid alt/]
\`\`\`

### Arrow Types
- \`A --> B\` - Solid arrow
- \`A --- B\` - Solid line (no arrow)
- \`A -.-> B\` - Dotted arrow
- \`A ==> B\` - Thick arrow
- \`A -- text --> B\` - Arrow with label
- \`A -->|text| B\` - Arrow with label (alt)

### Subgraphs
\`\`\`mermaid
flowchart TB
    subgraph Group1 [Title]
        A --> B
    end
    subgraph Group2
        C --> D
    end
    B --> C
\`\`\`

### Styling
\`\`\`mermaid
flowchart LR
    A:::customClass --> B
    classDef customClass fill:#f9f,stroke:#333
\`\`\``,
      bestPractices: [
        "Use meaningful IDs: `userLogin` not `A`",
        "Add labels to edges for clarity: `A -->|validates| B`",
        "Group related nodes with subgraphs",
        "Prefer TD/LR for readability",
        "Keep diagrams focused - split large flows",
        "Use different shapes to indicate node types",
      ],
    },

    sequence: {
      syntax: `## Sequence Diagram Syntax

### Basic Messages
\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Bob-->>Alice: Hi!
\`\`\`

### Arrow Types
- \`->>\` - Solid line with arrowhead (sync)
- \`-->>\` - Dotted line with arrowhead (async)
- \`-)\` - Solid line with open arrow
- \`--)\` - Dotted line with open arrow
- \`-x\` - Solid line with cross (lost message)
- \`--x\` - Dotted line with cross

### Participants
\`\`\`mermaid
sequenceDiagram
    participant A as Alice
    actor U as User
    A->>U: Hello
\`\`\`

### Activation
\`\`\`mermaid
sequenceDiagram
    Alice->>+Bob: Request
    Bob-->>-Alice: Response
\`\`\`

### Notes
\`\`\`mermaid
sequenceDiagram
    Alice->>Bob: Hello
    Note right of Bob: Thinking...
    Note over Alice,Bob: Both see this
\`\`\`

### Grouping
\`\`\`mermaid
sequenceDiagram
    alt Success
        A->>B: OK
    else Failure
        A->>B: Error
    end

    loop Every minute
        A->>B: Ping
    end

    opt Optional
        A->>B: Maybe
    end

    par Parallel
        A->>B: Task 1
    and
        A->>C: Task 2
    end
\`\`\`

### Auto-numbering
\`\`\`mermaid
sequenceDiagram
    autonumber
    Alice->>Bob: Step 1
    Bob->>Alice: Step 2
\`\`\``,
      bestPractices: [
        "Define participants upfront for control",
        "Use activate/deactivate for lifeline focus",
        "Use different arrow types: sync (->>) vs async (-->>)",
        "Add notes for important context",
        "Group with alt/loop/opt for clarity",
        "Use autonumber for step sequences",
      ],
    },

    classDiagram: {
      syntax: `## Class Diagram Syntax

### Basic Class
\`\`\`mermaid
classDiagram
    class Animal {
        +String name
        +int age
        +eat()
        +sleep()
    }
\`\`\`

### Visibility
- \`+\` Public
- \`-\` Private
- \`#\` Protected
- \`~\` Package/Internal

### Relationships
- \`<|--\` Inheritance
- \`*--\` Composition
- \`o--\` Aggregation
- \`-->\` Association
- \`--\` Link (solid)
- \`..>\` Dependency
- \`..\` Link (dashed)
- \`<|..\` Realization

### Cardinality
\`\`\`mermaid
classDiagram
    Customer "1" --> "*" Order : places
    Order "1" *-- "1..*" LineItem : contains
\`\`\`

### Annotations
\`\`\`mermaid
classDiagram
    class Shape {
        <<interface>>
        +draw()
    }
    class Circle {
        <<service>>
    }
\`\`\``,
      bestPractices: [
        "Use visibility modifiers consistently",
        "Show only relevant attributes/methods",
        "Use proper relationship types",
        "Add cardinality for clarity",
        "Use annotations for stereotypes",
      ],
    },

    erDiagram: {
      syntax: `## ER Diagram Syntax

### Basic Syntax
\`\`\`mermaid
erDiagram
    CUSTOMER ||--o{ ORDER : places
    ORDER ||--|{ LINE-ITEM : contains
    CUSTOMER }|..|{ DELIVERY-ADDRESS : uses
\`\`\`

### Cardinality
- \`||\` - Exactly one
- \`o|\` - Zero or one
- \`}|\` - One or more
- \`}o\` - Zero or more

### Relationship Types
- \`--\` - Identifying (solid)
- \`..\` - Non-identifying (dashed)

### Attributes
\`\`\`mermaid
erDiagram
    CUSTOMER {
        int id PK
        string name
        string email UK
    }
    ORDER {
        int id PK
        int customer_id FK
        date created_at
    }
\`\`\``,
      bestPractices: [
        "Use singular entity names (Customer not Customers)",
        "Mark PK/FK/UK constraints",
        "Use proper cardinality notation",
        "Group related entities visually",
      ],
    },

    stateDiagram: {
      syntax: `## State Diagram Syntax

### Basic Syntax
\`\`\`mermaid
stateDiagram-v2
    [*] --> Active
    Active --> Inactive: disable
    Inactive --> Active: enable
    Inactive --> [*]: terminate
\`\`\`

### Composite States
\`\`\`mermaid
stateDiagram-v2
    state Active {
        [*] --> Running
        Running --> Paused: pause
        Paused --> Running: resume
    }
\`\`\`

### Fork/Join
\`\`\`mermaid
stateDiagram-v2
    state fork_state <<fork>>
    [*] --> fork_state
    fork_state --> State2
    fork_state --> State3
\`\`\`

### Notes
\`\`\`mermaid
stateDiagram-v2
    State1: Description here
    note right of State1: Additional note
\`\`\``,
      bestPractices: [
        "Use [*] for start/end states",
        "Label transitions with trigger events",
        "Use composite states for sub-machines",
        "Keep state names descriptive",
      ],
    },

    gantt: {
      syntax: `## Gantt Chart Syntax

\`\`\`mermaid
gantt
    title Project Timeline
    dateFormat YYYY-MM-DD

    section Phase 1
    Task A           :a1, 2024-01-01, 30d
    Task B           :after a1, 20d

    section Phase 2
    Task C           :2024-02-15, 12d
    Milestone        :milestone, m1, 2024-03-01, 0d

    section Phase 3
    Task D           :crit, 2024-03-01, 10d
    Task E           :active, 2024-03-10, 15d
\`\`\`

### Task Modifiers
- \`crit\` - Critical path (highlighted)
- \`active\` - Currently active
- \`done\` - Completed
- \`milestone\` - Milestone marker

### Date Formats
- \`YYYY-MM-DD\` - ISO format
- Duration: \`1d\`, \`1w\`, \`1h\``,
      bestPractices: [
        "Use sections for logical grouping",
        "Define dependencies with 'after'",
        "Mark critical path with 'crit'",
        "Use milestones for key dates",
      ],
    },

    mindmap: {
      syntax: `## Mind Map Syntax

\`\`\`mermaid
mindmap
  root((Central Topic))
    Branch A
      Leaf 1
      Leaf 2
    Branch B
      Leaf 3
        Sub-leaf
    Branch C
\`\`\`

### Node Shapes
- \`((text))\` - Circle
- \`(text)\` - Rounded rectangle
- \`[text]\` - Square
- \`)text(\` - Bang (explosion)
- \`))text((\` - Cloud`,
      bestPractices: [
        "Use indentation for hierarchy",
        "Keep branch labels concise",
        "Limit depth for readability",
      ],
    },

    gitGraph: {
      syntax: `## Git Graph Syntax

\`\`\`mermaid
gitGraph
    commit
    commit
    branch develop
    checkout develop
    commit
    commit
    checkout main
    merge develop
    commit
    branch feature
    checkout feature
    commit
    checkout main
    merge feature
\`\`\`

### Commands
- \`commit\` - Add commit
- \`branch name\` - Create branch
- \`checkout name\` - Switch branch
- \`merge name\` - Merge branch
- \`cherry-pick id\` - Cherry-pick commit`,
      bestPractices: [
        "Show realistic branching strategies",
        "Use meaningful branch names",
        "Keep history linear when possible",
      ],
    },
  },

  references: [
    "https://mermaid.js.org/intro/syntax-reference.html",
    "https://mermaid.ai/open-source/syntax/flowchart.html",
    "https://mermaid.ai/open-source/syntax/sequenceDiagram.html",
    "https://github.com/mermaid-js/mermaid",
  ],
};
