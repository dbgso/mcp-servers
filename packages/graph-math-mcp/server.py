#!/usr/bin/env python3
"""
Graph Math MCP Server

A lightweight MCP server that provides graph theory calculations using NetworkX.
Designed for task analysis and project planning - pure calculation engine.

Features:
- Topological Sort: Get dependency-respecting execution order
- Critical Path: Find the longest path (bottleneck) in weighted graphs
- Cycle Detection: Detect deadlocks / circular dependencies
"""
import asyncio
import json
from typing import Any

import networkx as nx
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent


# Guidelines
OVERVIEW = """# Graph Math MCP

A lightweight graph calculation engine for task analysis and project planning.

## Philosophy

- **LLM's job**: Extract tasks (nodes) and dependencies (edges) from text
- **This MCP's job**: Perform mathematically correct graph calculations
- **LLM's job**: Translate results into human-readable text/diagrams

## Input Format

All operations accept JSON with `nodes` and `edges`:

```json
{
  "nodes": [
    {"id": "A", "duration": 3},
    {"id": "B", "duration": 2},
    {"id": "C", "duration": 4}
  ],
  "edges": [
    {"from": "A", "to": "B"},
    {"from": "A", "to": "C"}
  ]
}
```

- `nodes[].id`: Required. Task identifier.
- `nodes[].duration`: Optional. Task duration (for critical path).
- `edges[].from/to`: Dependency direction. "from" must complete before "to".

## Available Operations

| Operation | Description |
|-----------|-------------|
| topological_sort | Get execution order respecting all dependencies |
| critical_path | Find the longest path (bottleneck route) |
| detect_cycles | Find circular dependencies (deadlocks) |

Use `graph_describe(operation: "...")` for operation-specific details.
"""

OPERATIONS = {
    "topological_sort": {
        "description": "Topological Sort - Get execution order",
        "detail": """# Topological Sort

Returns tasks in an order where all dependencies are satisfied.
If task B depends on A, then A will always come before B.

## Use Cases
- Determining task execution order
- Build system dependency resolution
- Course prerequisite ordering

## Input
```json
{
  "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
  "edges": [{"from": "A", "to": "B"}, {"from": "B", "to": "C"}]
}
```

## Output
```json
{
  "success": true,
  "order": ["A", "B", "C"],
  "parallel_groups": [["A"], ["B"], ["C"]]
}
```

- `order`: Linear execution order
- `parallel_groups`: Tasks grouped by execution level (tasks in same group can run in parallel)

## Note
Returns error if cycles exist (use `detect_cycles` first to check).
""",
    },
    "critical_path": {
        "description": "Critical Path - Find the longest path",
        "detail": """# Critical Path

Finds the longest path through the task graph.
Tasks on this path have zero buffer - any delay directly impacts project completion.

## Use Cases
- Identifying bottleneck tasks
- Project timeline estimation
- Resource allocation prioritization

## Input
```json
{
  "nodes": [
    {"id": "A", "duration": 3},
    {"id": "B", "duration": 2},
    {"id": "C", "duration": 5}
  ],
  "edges": [
    {"from": "A", "to": "B"},
    {"from": "A", "to": "C"}
  ]
}
```

## Output
```json
{
  "success": true,
  "critical_path": ["A", "C"],
  "total_duration": 8,
  "all_paths": [
    {"path": ["A", "C"], "duration": 8},
    {"path": ["A", "B"], "duration": 5}
  ]
}
```

## Note
- Requires `duration` on each node
- Returns error if cycles exist
""",
    },
    "detect_cycles": {
        "description": "Cycle Detection - Find circular dependencies",
        "detail": """# Cycle Detection

Detects circular dependencies (deadlocks) in task graphs.
A cycle like A -> B -> C -> A means no task can start.

## Use Cases
- Validating task graphs before execution
- Finding deadlocks in dependency chains
- Debugging "why won't this build?"

## Input
```json
{
  "nodes": [{"id": "A"}, {"id": "B"}, {"id": "C"}],
  "edges": [
    {"from": "A", "to": "B"},
    {"from": "B", "to": "C"},
    {"from": "C", "to": "A"}
  ]
}
```

## Output
```json
{
  "success": true,
  "has_cycles": true,
  "cycles": [["A", "B", "C", "A"]],
  "cycle_count": 1
}
```

## Note
Always run this before `topological_sort` or `critical_path` to ensure graph is valid.
""",
    },
}


def build_graph(data: dict) -> nx.DiGraph:
    """Build a NetworkX DiGraph from input data."""
    G = nx.DiGraph()

    nodes = data.get("nodes", [])
    edges = data.get("edges", [])

    for node in nodes:
        node_id = node.get("id")
        if node_id is None:
            raise ValueError("Each node must have an 'id' field")
        duration = node.get("duration", 1)
        G.add_node(node_id, duration=duration)

    for edge in edges:
        from_node = edge.get("from")
        to_node = edge.get("to")
        if from_node is None or to_node is None:
            raise ValueError("Each edge must have 'from' and 'to' fields")
        G.add_edge(from_node, to_node)

    return G


def execute_topological_sort(data: dict) -> dict:
    """Execute topological sort operation."""
    try:
        G = build_graph(data)

        # Check for cycles first
        if not nx.is_directed_acyclic_graph(G):
            return {
                "success": False,
                "error": "Graph contains cycles. Use detect_cycles to find them.",
            }

        # Get topological order
        order = list(nx.topological_sort(G))

        # Group by generation (parallel execution levels)
        generations = list(nx.topological_generations(G))
        parallel_groups = [list(gen) for gen in generations]

        return {
            "success": True,
            "order": order,
            "parallel_groups": parallel_groups,
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def execute_critical_path(data: dict) -> dict:
    """Execute critical path calculation."""
    try:
        G = build_graph(data)

        # Check for cycles
        if not nx.is_directed_acyclic_graph(G):
            return {
                "success": False,
                "error": "Graph contains cycles. Cannot compute critical path.",
            }

        # Find all source nodes (no incoming edges)
        sources = [n for n in G.nodes() if G.in_degree(n) == 0]
        # Find all sink nodes (no outgoing edges)
        sinks = [n for n in G.nodes() if G.out_degree(n) == 0]

        if not sources or not sinks:
            return {
                "success": False,
                "error": "Graph must have at least one source and one sink node.",
            }

        # Calculate all paths with durations
        all_paths = []
        for source in sources:
            for sink in sinks:
                for path in nx.all_simple_paths(G, source, sink):
                    duration = sum(G.nodes[n].get("duration", 1) for n in path)
                    all_paths.append({"path": path, "duration": duration})

        if not all_paths:
            return {
                "success": False,
                "error": "No paths found between source and sink nodes.",
            }

        # Sort by duration descending
        all_paths.sort(key=lambda x: x["duration"], reverse=True)

        # Critical path is the longest
        critical = all_paths[0]

        return {
            "success": True,
            "critical_path": critical["path"],
            "total_duration": critical["duration"],
            "all_paths": all_paths[:10],  # Limit to top 10 paths
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


def execute_detect_cycles(data: dict) -> dict:
    """Execute cycle detection."""
    try:
        G = build_graph(data)

        # Find all cycles
        try:
            cycles = list(nx.simple_cycles(G))
            # Format cycles to show the loop back
            formatted_cycles = []
            for cycle in cycles:
                if cycle:
                    formatted_cycles.append(cycle + [cycle[0]])
        except nx.NetworkXNoCycle:
            cycles = []
            formatted_cycles = []

        has_cycles = len(cycles) > 0

        return {
            "success": True,
            "has_cycles": has_cycles,
            "cycles": formatted_cycles,
            "cycle_count": len(cycles),
        }
    except Exception as e:
        return {"success": False, "error": str(e)}


# Create MCP server
server = Server("graph-math-mcp")


@server.list_tools()
async def list_tools():
    """List available tools."""
    return [
        Tool(
            name="graph_describe",
            description="List available operations or get details for a specific operation. Use without arguments to see all operations, or specify an operation ID for details including input/output schema.",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "description": "Operation ID for details (omit for full list)",
                    },
                },
            },
        ),
        Tool(
            name="graph_execute",
            description="Execute a graph operation. Use graph_describe to see available operations and parameters.",
            inputSchema={
                "type": "object",
                "properties": {
                    "operation": {
                        "type": "string",
                        "enum": list(OPERATIONS.keys()),
                        "description": "Operation ID (use graph_describe to see available operations)",
                    },
                    "data": {
                        "type": "object",
                        "description": "Graph data with 'nodes' and 'edges' arrays",
                        "properties": {
                            "nodes": {
                                "type": "array",
                                "description": "Array of node objects with 'id' and optional 'duration'",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "id": {"type": "string"},
                                        "duration": {"type": "number"},
                                    },
                                    "required": ["id"],
                                },
                            },
                            "edges": {
                                "type": "array",
                                "description": "Array of edge objects with 'from' and 'to'",
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "from": {"type": "string"},
                                        "to": {"type": "string"},
                                    },
                                    "required": ["from", "to"],
                                },
                            },
                        },
                    },
                },
                "required": ["operation", "data"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict) -> list[TextContent]:
    """Handle tool calls."""

    if name == "graph_describe":
        operation = arguments.get("operation")

        if not operation:
            return [TextContent(type="text", text=OVERVIEW)]

        op_info = OPERATIONS.get(operation)
        if not op_info:
            available = ", ".join(OPERATIONS.keys())
            return [TextContent(
                type="text",
                text=f"Unknown operation: {operation}\n\nAvailable: {available}",
            )]

        return [TextContent(type="text", text=op_info["detail"])]

    elif name == "graph_execute":
        operation = arguments.get("operation")
        data = arguments.get("data", {})

        if not operation:
            return [TextContent(
                type="text",
                text="Error: 'operation' is required. Use graph_describe to see available operations.",
            )]

        if operation == "topological_sort":
            result = execute_topological_sort(data)
        elif operation == "critical_path":
            result = execute_critical_path(data)
        elif operation == "detect_cycles":
            result = execute_detect_cycles(data)
        else:
            available = ", ".join(OPERATIONS.keys())
            return [TextContent(
                type="text",
                text=f"Unknown operation: {operation}\n\nAvailable: {available}",
            )]

        return [TextContent(type="text", text=json.dumps(result, indent=2))]

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
