/**
 * D2 detailed guidelines based on official documentation
 * Sources:
 * - https://d2lang.com/
 * - https://blog.logrocket.com/complete-guide-declarative-diagramming-d2/
 * - https://github.com/terrastruct/d2
 */

export const d2Guidelines = {
  overview: `D2 is a modern declarative diagramming language that turns text to diagrams with clean syntax and beautiful output.

## Key Features
- Clean, readable syntax
- Multiple layout engines (Dagre, ELK, TALA)
- Production-ready themes
- Icons and images support
- Interactive tooltips and links

## Layout Engines
- **Dagre** (default): Based on Graphviz DOT algorithm
- **ELK**: Suited for node-link diagrams with ports
- **TALA**: Designed specifically for software architecture diagrams

## Basic Structure
\`\`\`d2
x -> y: connection label
\`\`\`

## Comments
Use \`#\` for comments (Bash-style):
\`\`\`d2
# This is a comment
x -> y  # End of line comment
\`\`\``,

  subDiagrams: {
    basic: {
      syntax: `## Basic Diagram Syntax

### Shapes
\`\`\`d2
# Default is rectangle
my_shape

# With label
my_shape: Custom Label

# Shape types
cloud: Cloud Shape {
  shape: cloud
}
circle: Round {
  shape: circle
}
oval: Ellipse {
  shape: oval
}
diamond: Decision {
  shape: diamond
}
hexagon: Process {
  shape: hexagon
}
cylinder: Database {
  shape: cylinder
}
queue: Message Queue {
  shape: queue
}
person: User {
  shape: person
}
\`\`\`

### Available Shapes
- rectangle (default)
- square
- page
- parallelogram
- document
- cylinder
- queue
- package
- step
- callout
- stored_data
- person
- diamond
- oval
- circle
- hexagon
- cloud
- text
- code
- class
- sql_table
- image
- sequence_diagram

### Multiple Shapes
\`\`\`d2
# Semicolon for multiple on one line
a; b; c

# Or separate lines
x
y
z
\`\`\``,
      bestPractices: [
        "Use meaningful shape IDs",
        "Add labels for clarity",
        "Choose appropriate shapes for context",
        "Use semicolons for compact layouts",
      ],
    },

    connections: {
      syntax: `## Connections Syntax

### Arrow Types
\`\`\`d2
# Forward connection
a -> b

# Backward connection
a <- b

# Bidirectional
a <-> b

# Line without arrow
a -- b
\`\`\`

### Connection Labels
\`\`\`d2
a -> b: sends request
b -> c: processes
c -> a: returns response
\`\`\`

### Chained Connections
\`\`\`d2
# Chain of connections
a -> b -> c -> d

# With labels
x -> y: step 1 -> z: step 2
\`\`\`

### Multiple Connections
\`\`\`d2
server -> db
server -> cache
server -> queue

# Or more compact
server -> {db; cache; queue}
\`\`\`

### Self-referencing
\`\`\`d2
process -> process: retry
\`\`\``,
      bestPractices: [
        "Use arrow direction to show data flow",
        "Add labels to describe interactions",
        "Chain connections for sequential flows",
        "Use bidirectional arrows sparingly",
      ],
    },

    containers: {
      syntax: `## Containers Syntax

### Basic Container
\`\`\`d2
server: Web Server {
  api: API Layer
  db: Database
  api -> db
}
\`\`\`

### Nested Containers
\`\`\`d2
cloud: AWS {
  region: us-east-1 {
    vpc: VPC {
      subnet: Private Subnet {
        ec2: EC2 Instance
        rds: RDS Database
      }
    }
  }
}
\`\`\`

### Cross-container Connections
\`\`\`d2
frontend: Frontend {
  app: React App
}

backend: Backend {
  api: API Server
  db: Database
}

frontend.app -> backend.api: REST calls
backend.api -> backend.db: queries
\`\`\`

### Container Styling
\`\`\`d2
service: My Service {
  style: {
    fill: "#e1f5fe"
    stroke: "#0288d1"
    border-radius: 8
  }

  component1
  component2
}
\`\`\``,
      bestPractices: [
        "Use containers to group related components",
        "Nest for hierarchy (cloud > region > vpc)",
        "Reference nested elements with dot notation",
        "Apply consistent styling per container type",
      ],
    },

    sequence: {
      syntax: `## Sequence Diagram Syntax

### Basic Sequence
\`\`\`d2
shape: sequence_diagram

alice: Alice
bob: Bob
charlie: Charlie

alice -> bob: Hello
bob -> charlie: Forward
charlie -> bob: Response
bob -> alice: Done
\`\`\`

### Groups and Spans
\`\`\`d2
shape: sequence_diagram

user: User
auth: Auth Service
api: API

user -> auth: Login request
auth -> auth: Validate credentials
auth -> user: Token

user -> api: API request with token
api -> auth: Verify token
auth -> api: Valid
api -> user: Response
\`\`\`

### Notes
\`\`\`d2
shape: sequence_diagram

a: Service A
b: Service B

a -> b: Request
a."This is a note": "" {
  shape: text
}
b -> a: Response
\`\`\``,
      bestPractices: [
        "Set `shape: sequence_diagram` at top level",
        "Define participants before messages",
        "Show self-calls for internal processing",
        "Keep message labels concise",
      ],
    },

    class: {
      syntax: `## Class Diagram Syntax

### Basic Class
\`\`\`d2
User: {
  shape: class

  # Attributes
  +id: int
  +name: string
  -email: string
  #password: string

  # Methods
  +login()
  +logout()
  -hashPassword()
}
\`\`\`

### Class Relationships
\`\`\`d2
Animal: {
  shape: class
  +name: string
  +age: int
  +eat()
}

Dog: {
  shape: class
  +breed: string
  +bark()
}

Cat: {
  shape: class
  +color: string
  +meow()
}

Dog -> Animal: extends
Cat -> Animal: extends
\`\`\`

### Interfaces
\`\`\`d2
Repository: {
  shape: class
  style.font-style: italic

  +save()
  +find()
  +delete()
}

UserRepository: {
  shape: class
  +save()
  +find()
  +delete()
}

UserRepository -> Repository: implements
\`\`\``,
      bestPractices: [
        "Use `shape: class` for UML-style classes",
        "Show visibility with +/-/#",
        "Group related classes in containers",
        "Label relationships clearly",
      ],
    },

    grid: {
      syntax: `## Grid Layout Syntax

### Basic Grid
\`\`\`d2
grid-rows: 2
grid-columns: 3

a; b; c
d; e; f
\`\`\`

### Architecture Grid
\`\`\`d2
grid-rows: 3
grid-gap: 10

# Row 1 - Presentation
Web App; Mobile App; API Gateway

# Row 2 - Services
Auth Service; Order Service; Payment Service

# Row 3 - Data
PostgreSQL; Redis; S3
\`\`\`

### Named Grid Positions
\`\`\`d2
grid-rows: 2
grid-columns: 2

tl: Top Left {
  grid-row: 1
  grid-column: 1
}
br: Bottom Right {
  grid-row: 2
  grid-column: 2
}
\`\`\``,
      bestPractices: [
        "Use grids for layered architectures",
        "Set grid-gap for spacing",
        "Keep rows for same abstraction level",
      ],
    },

    styling: {
      syntax: `## Styling Syntax

### Shape Styling
\`\`\`d2
my_shape: Styled Shape {
  style: {
    fill: "#f0f0f0"
    stroke: "#333"
    stroke-width: 2
    border-radius: 8
    shadow: true
    opacity: 0.9
    font-size: 16
    font-color: "#000"
    bold: true
    italic: false
  }
}
\`\`\`

### Connection Styling
\`\`\`d2
a -> b: {
  style: {
    stroke: "#ff0000"
    stroke-width: 2
    stroke-dash: 5
    animated: true
  }
}
\`\`\`

### Icons
\`\`\`d2
server: Web Server {
  icon: https://icons.terrastruct.com/essentials/server.svg
}

database: PostgreSQL {
  icon: https://icons.terrastruct.com/dev/postgresql.svg
  shape: cylinder
}
\`\`\`

### Dimensions
\`\`\`d2
large_box: Big Component {
  width: 200
  height: 100
}
\`\`\``,
      bestPractices: [
        "Use consistent color schemes",
        "Apply opacity for layering effects",
        "Use stroke-dash for different connection types",
        "Add icons for recognizable services",
        "Use animated for data flow emphasis",
      ],
    },
  },

  references: [
    "https://d2lang.com/",
    "https://d2lang.com/tour/intro",
    "https://github.com/terrastruct/d2",
    "https://blog.logrocket.com/complete-guide-declarative-diagramming-d2/",
  ],
};
