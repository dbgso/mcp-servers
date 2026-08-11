/**
 * PlantUML detailed guidelines based on official documentation
 * Sources:
 * - https://plantuml.com/sequence-diagram
 * - https://plantuml.com/class-diagram
 * - https://pdf.plantuml.net/PlantUML_Language_Reference_Guide_en.pdf
 */

export const plantumlGuidelines = {
  overview: `PlantUML is a comprehensive UML diagramming tool with extensive features for software documentation.

## Supported Diagram Types
- Sequence, Use Case, Class, Object, Activity
- Component, Deployment, State, Timing
- JSON, YAML, Network (nwdiag), Wireframe
- Archimate, SDL, Ditaa, Gantt, Mindmap
- WBS, Maths (AsciiMath, JLaTeXMath), ER

## Basic Structure
All diagrams are wrapped in \`@startuml\` / \`@enduml\`:
\`\`\`plantuml
@startuml
Alice -> Bob: Hello
@enduml
\`\`\`

## Key Features
- Full UML 2.x support
- Highly customizable with skinparam
- Preprocessor with !define, !include
- Multiple output formats (PNG, SVG, PDF, LaTeX)
- Integration with Confluence, GitHub, VS Code`,

  subDiagrams: {
    sequence: {
      syntax: `## Sequence Diagram Syntax

### Basic Messages
\`\`\`plantuml
@startuml
Alice -> Bob: Solid line
Alice --> Bob: Dotted line
Alice ->> Bob: Thin arrow
Alice -->> Bob: Dotted thin
@enduml
\`\`\`

### Arrow Types
- \`->\` Solid line with arrow
- \`-->\` Dotted line with arrow
- \`->>\` Thin arrow
- \`->x\` Lost message
- \`->o\` Circle endpoint
- \`<->\` Bidirectional
- \`-[#red]>\` Colored arrow

### Participant Types
\`\`\`plantuml
@startuml
participant Participant as P
actor Actor as A
boundary Boundary as B
control Control as C
entity Entity as E
database Database as D
collections Collections as Co
queue Queue as Q

P -> A: message
@enduml
\`\`\`

### Activation & Lifelines
\`\`\`plantuml
@startuml
Alice -> Bob: Request
activate Bob
Bob -> Bob: Process
Bob --> Alice: Response
deactivate Bob

' Shorthand
Alice ->++ Bob: Request
Bob -->-- Alice: Response
@enduml
\`\`\`

### Grouping
\`\`\`plantuml
@startuml
Alice -> Bob: Request

alt Success
    Bob --> Alice: OK
else Failure
    Bob --> Alice: Error
end

loop Every 5 seconds
    Alice -> Bob: Ping
end

opt Optional
    Bob -> Charlie: Forward
end

par Parallel
    Alice -> Bob: Task1
else
    Alice -> Charlie: Task2
end

critical Critical Section
    Bob -> Database: Update
end

group Custom Label [condition]
    Alice -> Bob: Message
end
@enduml
\`\`\`

### Notes
\`\`\`plantuml
@startuml
Alice -> Bob: Hello
note left: Left note
note right: Right note
note over Alice: Over participant
note over Alice, Bob: Spanning note
hnote over Bob: Hexagonal note
rnote over Alice: Rectangle note
@enduml
\`\`\`

### Dividers & Delays
\`\`\`plantuml
@startuml
Alice -> Bob: Step 1
== Initialization ==
Bob -> Charlie: Step 2
... 5 minutes later ...
Charlie --> Alice: Done
@enduml
\`\`\`

### Auto-numbering
\`\`\`plantuml
@startuml
autonumber
Alice -> Bob: Step 1
Bob -> Charlie: Step 2
autonumber stop
Charlie -> Alice: Not numbered
autonumber resume
Alice -> Bob: Step 3
@enduml
\`\`\`

### Create & Destroy
\`\`\`plantuml
@startuml
Alice -> Bob: Create request
create Charlie
Bob -> Charlie: Initialize
Charlie --> Bob: Ready
Bob --> Alice: Done
destroy Charlie
@enduml
\`\`\``,
      bestPractices: [
        "Use participant with stereotype for context",
        "Use autonumber for step-by-step flows",
        "Group with alt/loop/opt for clarity",
        "Add notes for important context",
        "Use activate/deactivate for focus",
        "Use dividers (==) for phase separation",
      ],
    },

    class: {
      syntax: `## Class Diagram Syntax

### Basic Class
\`\`\`plantuml
@startuml
class Animal {
    +String name
    -int age
    #void eat()
    ~void sleep()
    {static} int count
    {abstract} void move()
}
@enduml
\`\`\`

### Visibility
- \`+\` Public
- \`-\` Private
- \`#\` Protected
- \`~\` Package

### Relationships
\`\`\`plantuml
@startuml
Class01 <|-- Class02 : Inheritance
Class03 *-- Class04 : Composition
Class05 o-- Class06 : Aggregation
Class07 --> Class08 : Association
Class09 -- Class10 : Link
Class11 ..> Class12 : Dependency
Class13 ..|> Class14 : Realization
@enduml
\`\`\`

### Cardinality
\`\`\`plantuml
@startuml
Customer "1" --> "*" Order
Order "1" *-- "1..*" LineItem
@enduml
\`\`\`

### Stereotypes & Notes
\`\`\`plantuml
@startuml
class Service <<Singleton>> {
    +getInstance()
}
interface Repository <<interface>> {
    +save()
    +find()
}
abstract class BaseEntity <<abstract>>

note right of Service : This is a note
note "Floating note" as N1
@enduml
\`\`\`

### Packages
\`\`\`plantuml
@startuml
package "Domain" {
    class User
    class Order
}
package "Infrastructure" <<Database>> {
    class UserRepository
}
User --> UserRepository
@enduml
\`\`\`

### Skinparam Styling
\`\`\`plantuml
@startuml
skinparam classAttributeIconSize 0
skinparam class {
    BackgroundColor White
    BorderColor Black
    ArrowColor Gray
}
class Example
@enduml
\`\`\``,
      bestPractices: [
        "Use packages for logical grouping",
        "Apply stereotypes (<<interface>>, <<abstract>>)",
        "Show only relevant members",
        "Use proper relationship arrows",
        "Add notes for complex logic",
        "Use skinparam for consistent styling",
      ],
    },

    component: {
      syntax: `## Component Diagram Syntax

\`\`\`plantuml
@startuml
package "Frontend" {
    [Web App] as webapp
    [Mobile App] as mobile
}

package "Backend" {
    [API Gateway] as api
    [Auth Service] as auth
    [Order Service] as order
}

database "Database" {
    [PostgreSQL] as db
}

webapp --> api
mobile --> api
api --> auth
api --> order
order --> db
@enduml
\`\`\`

### Interface Notation
\`\`\`plantuml
@startuml
component [Component]
interface "REST API" as api
[Component] - api
[Client] --> api
@enduml
\`\`\``,
      bestPractices: [
        "Use packages for logical boundaries",
        "Show interfaces for clear contracts",
        "Label connections with protocols",
        "Use database symbol for data stores",
      ],
    },

    activity: {
      syntax: `## Activity Diagram Syntax

\`\`\`plantuml
@startuml
start
:Step 1;
if (Condition?) then (yes)
    :Action A;
else (no)
    :Action B;
endif
:Step 2;
fork
    :Parallel 1;
fork again
    :Parallel 2;
end fork
stop
@enduml
\`\`\`

### Swimlanes
\`\`\`plantuml
@startuml
|User|
start
:Submit request;
|System|
:Process request;
:Validate;
|User|
:Receive result;
stop
@enduml
\`\`\``,
      bestPractices: [
        "Use swimlanes for responsibility separation",
        "Show decision points clearly",
        "Use fork/join for parallel activities",
      ],
    },

    state: {
      syntax: `## State Diagram Syntax

\`\`\`plantuml
@startuml
[*] --> Active
Active --> Inactive : disable
Inactive --> Active : enable
Active --> [*] : terminate

state Active {
    [*] --> Running
    Running --> Paused : pause
    Paused --> Running : resume
}

state fork_state <<fork>>
state join_state <<join>>
@enduml
\`\`\``,
      bestPractices: [
        "Use [*] for initial/final states",
        "Label transitions with events",
        "Use composite states for sub-machines",
        "Add descriptions with : syntax",
      ],
    },

    deployment: {
      syntax: `## Deployment Diagram Syntax

\`\`\`plantuml
@startuml
node "Web Server" {
    [Nginx]
    [Application]
}

node "Database Server" {
    database PostgreSQL
}

cloud "AWS" {
    node "EC2" as ec2
    storage "S3" as s3
}

[Nginx] --> [Application]
[Application] --> PostgreSQL
[Application] --> s3
@enduml
\`\`\``,
      bestPractices: [
        "Use appropriate symbols (node, cloud, database)",
        "Show physical/virtual boundaries",
        "Label network connections",
      ],
    },
  },

  references: [
    "https://plantuml.com/sequence-diagram",
    "https://plantuml.com/class-diagram",
    "https://plantuml.com/component-diagram",
    "https://pdf.plantuml.net/PlantUML_Language_Reference_Guide_en.pdf",
  ],
};
