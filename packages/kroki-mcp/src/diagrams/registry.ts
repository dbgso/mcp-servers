import type { DiagramTool, UseCaseRecommendation } from "./types.js";

/**
 * Registry of all supported diagram tools
 */
export const diagramTools: DiagramTool[] = [
  {
    id: "mermaid",
    name: "Mermaid",
    description: "JavaScript-based diagramming and charting tool with simple markdown-like syntax",
    website: "https://mermaid.js.org",
    strengths: [
      "Simple, intuitive syntax",
      "Wide variety of diagram types",
      "Excellent GitHub/GitLab integration",
      "Active community and documentation",
    ],
    weaknesses: [
      "Limited customization options",
      "Complex layouts can be difficult",
      "Auto-layout sometimes produces suboptimal results",
    ],
    bestFor: ["flowchart", "sequence", "class", "state", "er", "gantt", "mindmap"],
    subDiagrams: [
      {
        id: "flowchart",
        name: "Flowchart",
        category: "flowchart",
        description: "Flow diagrams, process flows, decision trees",
        example: "flowchart TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Action]\n    B -->|No| D[End]",
      },
      {
        id: "sequence",
        name: "Sequence Diagram",
        category: "sequence",
        description: "Interaction between actors/systems over time",
        example: "sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi!",
      },
      {
        id: "classDiagram",
        name: "Class Diagram",
        category: "class",
        description: "UML class diagrams showing relationships",
        example: "classDiagram\n    Animal <|-- Dog\n    Animal : +int age\n    Dog : +bark()",
      },
      {
        id: "stateDiagram",
        name: "State Diagram",
        category: "state",
        description: "State machine diagrams",
        example: "stateDiagram-v2\n    [*] --> Active\n    Active --> Inactive\n    Inactive --> [*]",
      },
      {
        id: "erDiagram",
        name: "ER Diagram",
        category: "er",
        description: "Entity-relationship diagrams for databases",
        example: 'erDiagram\n    CUSTOMER ||--o{ ORDER : places\n    ORDER ||--|{ LINE-ITEM : contains',
      },
      {
        id: "gantt",
        name: "Gantt Chart",
        category: "gantt",
        description: "Project timeline and scheduling",
        example: "gantt\n    title Project\n    section Phase 1\n    Task A :a1, 2024-01-01, 30d",
      },
      {
        id: "mindmap",
        name: "Mind Map",
        category: "mindmap",
        description: "Hierarchical mind maps",
        example: "mindmap\n  root((Central))\n    Topic A\n      Subtopic\n    Topic B",
      },
      {
        id: "pie",
        name: "Pie Chart",
        category: "general",
        description: "Simple pie charts",
        example: 'pie title Distribution\n    "A" : 40\n    "B" : 30\n    "C" : 30',
      },
      {
        id: "gitGraph",
        name: "Git Graph",
        category: "general",
        description: "Git branch visualization",
        example: "gitGraph\n    commit\n    branch develop\n    commit\n    checkout main\n    merge develop",
      },
    ],
  },
  {
    id: "plantuml",
    name: "PlantUML",
    description: "Comprehensive UML diagramming tool with extensive features",
    website: "https://plantuml.com",
    strengths: [
      "Full UML support",
      "Highly customizable styling",
      "Rich feature set",
      "Excellent for complex diagrams",
    ],
    weaknesses: [
      "Verbose syntax",
      "Steeper learning curve",
      "Requires Java runtime (self-hosted)",
    ],
    bestFor: ["sequence", "class", "state", "architecture", "process"],
    subDiagrams: [
      {
        id: "sequence",
        name: "Sequence Diagram",
        category: "sequence",
        description: "Detailed sequence diagrams with advanced features",
        example: "@startuml\nAlice -> Bob: Request\nBob --> Alice: Response\n@enduml",
      },
      {
        id: "class",
        name: "Class Diagram",
        category: "class",
        description: "Full UML class diagrams",
        example: "@startuml\nclass Animal {\n  +age: int\n  +eat()\n}\nDog --|> Animal\n@enduml",
      },
      {
        id: "usecase",
        name: "Use Case Diagram",
        category: "process",
        description: "Actor and use case relationships",
        example: "@startuml\nactor User\nUser --> (Login)\nUser --> (Browse)\n@enduml",
      },
      {
        id: "activity",
        name: "Activity Diagram",
        category: "flowchart",
        description: "Workflow and activity flows",
        example: "@startuml\nstart\n:Step 1;\nif (condition?) then (yes)\n  :Step 2;\nelse (no)\n  :Step 3;\nendif\nstop\n@enduml",
      },
      {
        id: "component",
        name: "Component Diagram",
        category: "architecture",
        description: "System component relationships",
        example: "@startuml\ncomponent [Web Server]\ncomponent [Database]\n[Web Server] --> [Database]\n@enduml",
      },
      {
        id: "deployment",
        name: "Deployment Diagram",
        category: "architecture",
        description: "Infrastructure and deployment",
        example: "@startuml\nnode Server {\n  component [App]\n}\ndatabase DB\nServer --> DB\n@enduml",
      },
      {
        id: "state",
        name: "State Diagram",
        category: "state",
        description: "State machine diagrams",
        example: "@startuml\n[*] --> Active\nActive --> Inactive : disable\nInactive --> [*]\n@enduml",
      },
    ],
  },
  {
    id: "d2",
    name: "D2",
    description: "Modern declarative diagramming language with clean syntax",
    website: "https://d2lang.com",
    strengths: [
      "Clean, readable syntax",
      "Excellent auto-layout (TALA, ELK, dagre)",
      "Beautiful default styling",
      "Good for architecture diagrams",
      "Supports icons and images",
    ],
    weaknesses: [
      "Fewer diagram types than Mermaid/PlantUML",
      "Smaller community",
      "Limited UML-specific features",
    ],
    bestFor: ["architecture", "flowchart", "network", "class"],
    subDiagrams: [
      {
        id: "basic",
        name: "Basic Diagrams",
        category: "general",
        description: "Simple node and edge diagrams",
        example: "a -> b -> c\nb -> d",
      },
      {
        id: "containers",
        name: "Container Diagrams",
        category: "architecture",
        description: "Nested containers for architecture",
        example: "server: {\n  api: API Server\n  db: Database\n  api -> db\n}\nclient -> server.api",
      },
      {
        id: "sequence",
        name: "Sequence Diagram",
        category: "sequence",
        description: "Sequence diagrams with D2 syntax",
        example: "shape: sequence_diagram\nalice -> bob: Hello\nbob -> alice: Hi!",
      },
      {
        id: "class",
        name: "Class Diagram",
        category: "class",
        description: "Class diagrams with methods and properties",
        example: "Animal: {\n  shape: class\n  +age: int\n  +eat()\n}\nDog -> Animal: extends",
      },
      {
        id: "grid",
        name: "Grid Diagrams",
        category: "general",
        description: "Grid-based layouts",
        example: "grid-rows: 2\na\nb\nc\nd",
      },
    ],
  },
  {
    id: "graphviz",
    name: "GraphViz (DOT)",
    description: "Classic graph visualization with powerful layout algorithms",
    website: "https://graphviz.org",
    strengths: [
      "Powerful layout algorithms",
      "Excellent for complex graphs",
      "Fine-grained control",
      "Industry standard",
    ],
    weaknesses: [
      "Verbose DOT syntax",
      "Limited to graph structures",
      "Styling requires detailed knowledge",
    ],
    bestFor: ["network", "flowchart", "general"],
    subDiagrams: [
      {
        id: "digraph",
        name: "Directed Graph",
        category: "general",
        description: "Directed graphs with arrows",
        example: 'digraph G {\n  a -> b\n  b -> c\n  a -> c\n}',
      },
      {
        id: "graph",
        name: "Undirected Graph",
        category: "network",
        description: "Undirected network graphs",
        example: 'graph G {\n  a -- b\n  b -- c\n  a -- c\n}',
      },
      {
        id: "cluster",
        name: "Clustered Graph",
        category: "architecture",
        description: "Grouped/clustered nodes",
        example: 'digraph G {\n  subgraph cluster_0 {\n    label="Group"\n    a; b\n  }\n  a -> c\n}',
      },
    ],
  },
  {
    id: "structurizr",
    name: "Structurizr",
    description: "C4 model architecture diagrams",
    website: "https://structurizr.com",
    strengths: [
      "Purpose-built for C4 model",
      "Consistent architecture visualization",
      "Multiple zoom levels (Context, Container, Component, Code)",
    ],
    weaknesses: [
      "C4-specific only",
      "More verbose syntax",
      "Requires understanding C4 model",
    ],
    bestFor: ["architecture"],
    subDiagrams: [
      {
        id: "systemContext",
        name: "System Context",
        category: "architecture",
        description: "Highest level showing system and external actors",
        example: "workspace {\n  model {\n    user = person \"User\"\n    system = softwareSystem \"System\"\n    user -> system\n  }\n  views {\n    systemContext system {\n      include *\n    }\n  }\n}",
      },
      {
        id: "container",
        name: "Container Diagram",
        category: "architecture",
        description: "Zoom into system showing containers",
        example: "# Container level C4 diagram",
      },
      {
        id: "component",
        name: "Component Diagram",
        category: "architecture",
        description: "Zoom into container showing components",
        example: "# Component level C4 diagram",
      },
    ],
  },
  {
    id: "excalidraw",
    name: "Excalidraw",
    description: "Hand-drawn style diagrams",
    website: "https://excalidraw.com",
    strengths: [
      "Beautiful hand-drawn aesthetic",
      "Great for informal diagrams",
      "Easy to understand visually",
    ],
    weaknesses: [
      "Not suitable for formal documentation",
      "Limited to basic shapes",
      "JSON-based format",
    ],
    bestFor: ["general", "flowchart"],
    subDiagrams: [
      {
        id: "sketch",
        name: "Sketch Diagrams",
        category: "general",
        description: "Hand-drawn style informal diagrams",
        example: "# Excalidraw uses JSON format",
      },
    ],
  },
];

/**
 * Use case recommendations
 */
export const useCaseRecommendations: UseCaseRecommendation[] = [
  {
    useCase: "API or service interaction flow",
    category: "sequence",
    recommended: [
      { toolId: "mermaid", subDiagramId: "sequence", reason: "Simple syntax, good for docs" },
      { toolId: "plantuml", subDiagramId: "sequence", reason: "More features for complex flows" },
    ],
  },
  {
    useCase: "System architecture overview",
    category: "architecture",
    recommended: [
      { toolId: "structurizr", reason: "Purpose-built for C4 architecture" },
      { toolId: "d2", subDiagramId: "containers", reason: "Clean syntax, beautiful output" },
      { toolId: "plantuml", subDiagramId: "component", reason: "Detailed UML components" },
    ],
  },
  {
    useCase: "Database schema / ER diagram",
    category: "er",
    recommended: [
      { toolId: "mermaid", subDiagramId: "erDiagram", reason: "Quick ER diagrams" },
      { toolId: "plantuml", reason: "More detailed relationships" },
    ],
  },
  {
    useCase: "Process flow / Decision tree",
    category: "flowchart",
    recommended: [
      { toolId: "mermaid", subDiagramId: "flowchart", reason: "Simple and readable" },
      { toolId: "d2", subDiagramId: "basic", reason: "Clean auto-layout" },
      { toolId: "plantuml", subDiagramId: "activity", reason: "Complex workflows" },
    ],
  },
  {
    useCase: "Class/object relationships",
    category: "class",
    recommended: [
      { toolId: "mermaid", subDiagramId: "classDiagram", reason: "Quick UML class diagrams" },
      { toolId: "plantuml", subDiagramId: "class", reason: "Full UML support" },
      { toolId: "d2", subDiagramId: "class", reason: "Modern, clean output" },
    ],
  },
  {
    useCase: "State machine / Lifecycle",
    category: "state",
    recommended: [
      { toolId: "mermaid", subDiagramId: "stateDiagram", reason: "Simple state diagrams" },
      { toolId: "plantuml", subDiagramId: "state", reason: "Complex state machines" },
    ],
  },
  {
    useCase: "Project timeline / Schedule",
    category: "gantt",
    recommended: [
      { toolId: "mermaid", subDiagramId: "gantt", reason: "Only option in Kroki" },
    ],
  },
  {
    useCase: "Network topology",
    category: "network",
    recommended: [
      { toolId: "graphviz", subDiagramId: "graph", reason: "Best for complex graphs" },
      { toolId: "d2", subDiagramId: "containers", reason: "Readable network diagrams" },
    ],
  },
  {
    useCase: "Mind map / Brainstorming",
    category: "mindmap",
    recommended: [
      { toolId: "mermaid", subDiagramId: "mindmap", reason: "Simple mind maps" },
    ],
  },
  {
    useCase: "Git branching strategy",
    category: "general",
    recommended: [
      { toolId: "mermaid", subDiagramId: "gitGraph", reason: "Purpose-built for git" },
    ],
  },
];

/**
 * Get all diagram tools
 */
export function getAllTools(): DiagramTool[] {
  return diagramTools;
}

/**
 * Get a specific diagram tool by ID
 */
export function getTool(id: string): DiagramTool | undefined {
  return diagramTools.find(t => t.id === id);
}

/**
 * Get recommendations for a use case
 */
export function getRecommendations(category?: string): UseCaseRecommendation[] {
  if (!category) return useCaseRecommendations;
  return useCaseRecommendations.filter(r => r.category === category);
}
