#!/usr/bin/env python3
"""
Python Diagrams MCP Server

An MCP server that renders diagrams using the Python diagrams library.
"""
import asyncio
import base64
import json
import os
import sys
import tempfile
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent, ImageContent

# Guidelines
OVERVIEW = """# Python Diagrams Library

The **diagrams** library lets you draw cloud system architecture diagrams using Python code.

## Basic Structure

```python
from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import EC2
from diagrams.aws.network import ELB

with Diagram("Web Service", show=False):
    ELB("lb") >> EC2("web")
```

## Key Concepts

- **Diagram**: Container for the entire diagram. Use `show=False` to prevent auto-opening.
- **Cluster**: Group nodes visually with a box.
- **Edge**: Customize connections (color, style, label).
- **Nodes**: Cloud provider resources (EC2, Lambda, etc.)

## Connection Operators

- `>>`: Left to right flow
- `<<`: Right to left flow
- `-`: Bidirectional / no direction

## Output Formats

- **PNG** (default): Best for sharing and embedding
- **SVG**: Scalable, good for documentation
- **PDF**: Print-ready format

## Available Providers

| Provider | Description |
|----------|-------------|
| aws | Amazon Web Services |
| azure | Microsoft Azure |
| gcp | Google Cloud Platform |
| k8s | Kubernetes |
| onprem | On-premises / Self-hosted |
| generic | Generic architecture icons |
| programming | Programming languages & frameworks |
| saas | SaaS products |
| firebase | Firebase services |
| elastic | Elastic Stack |

Use `diagrams_describe(category: "aws")` to get provider-specific guidelines.

## References

- Documentation: https://diagrams.mingrammer.com/
- GitHub: https://github.com/mingrammer/diagrams
"""

PROVIDERS = {
    "aws": {
        "name": "Amazon Web Services",
        "modules": ["analytics", "compute", "database", "network", "storage", "security", "ml", "integration"],
        "example": """from diagrams import Diagram, Cluster
from diagrams.aws.compute import EC2, ECS
from diagrams.aws.database import RDS
from diagrams.aws.network import ELB

with Diagram("AWS Architecture", show=False):
    lb = ELB("lb")
    with Cluster("Web Tier"):
        web = [EC2("web1"), EC2("web2")]
    db = RDS("db")
    lb >> web >> db""",
    },
    "gcp": {
        "name": "Google Cloud Platform",
        "modules": ["compute", "database", "network", "storage", "ml", "analytics"],
        "example": """from diagrams import Diagram, Cluster
from diagrams.gcp.compute import GCE, GKE
from diagrams.gcp.database import SQL

with Diagram("GCP Architecture", show=False):
    gke = GKE("gke")
    sql = SQL("cloudsql")
    gke >> sql""",
    },
    "k8s": {
        "name": "Kubernetes",
        "modules": ["compute", "network", "storage", "controlplane", "rbac"],
        "example": """from diagrams import Diagram, Cluster
from diagrams.k8s.compute import Pod, Deployment
from diagrams.k8s.network import Service, Ingress

with Diagram("K8s Architecture", show=False):
    ingress = Ingress("ingress")
    svc = Service("service")
    with Cluster("Deployment"):
        pods = [Pod("pod1"), Pod("pod2")]
    ingress >> svc >> pods""",
    },
    "onprem": {
        "name": "On-Premises",
        "modules": ["compute", "database", "network", "monitoring", "container", "queue"],
        "example": """from diagrams import Diagram, Cluster
from diagrams.onprem.compute import Server
from diagrams.onprem.database import PostgreSQL
from diagrams.onprem.network import Nginx

with Diagram("On-Prem Architecture", show=False):
    nginx = Nginx("nginx")
    with Cluster("App Servers"):
        apps = [Server("app1"), Server("app2")]
    db = PostgreSQL("postgres")
    nginx >> apps >> db""",
    },
}


def get_mime_type(ext: str) -> str:
    """Get MIME type for file extension."""
    return {
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".pdf": "application/pdf",
    }.get(ext, "application/octet-stream")


def render_diagram(code: str, output_format: str = "png") -> dict:
    """Execute diagram code and return result."""
    try:
        with tempfile.TemporaryDirectory() as tmpdir:
            os.chdir(tmpdir)

            exec_globals = {
                "__name__": "__main__",
                "__file__": "diagram.py",
            }

            exec(code, exec_globals)

            # Find generated file
            for ext in [f".{output_format}", ".png", ".svg", ".pdf"]:
                for f in Path(tmpdir).glob(f"*{ext}"):
                    with open(f, "rb") as fp:
                        content = fp.read()
                    return {
                        "success": True,
                        "filename": f.name,
                        "content": content,
                        "mime_type": get_mime_type(ext),
                    }

            return {
                "success": False,
                "error": "No diagram file was generated. Ensure your code creates a Diagram with show=False.",
            }
    except SyntaxError as e:
        return {"success": False, "error": f"Python syntax error: {e}"}
    except ImportError as e:
        return {"success": False, "error": f"Import error: {e}"}
    except Exception as e:
        return {"success": False, "error": str(e)}


# Create MCP server
server = Server("python-diagrams-mcp")


@server.list_tools()
async def list_tools():
    """List available tools."""
    return [
        Tool(
            name="diagrams_describe",
            description="Get Python diagrams library guidelines. Without arguments: overview. With category: provider-specific guidelines.",
            inputSchema={
                "type": "object",
                "properties": {
                    "category": {
                        "type": "string",
                        "enum": list(PROVIDERS.keys()),
                        "description": "Provider category (aws, gcp, k8s, onprem, etc.)",
                    },
                },
            },
        ),
        Tool(
            name="diagrams_render",
            description="Render a diagram using Python diagrams library. Returns PNG (default), SVG, or PDF. Optionally saves to file.",
            inputSchema={
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Python source code using the diagrams library",
                    },
                    "format": {
                        "type": "string",
                        "enum": ["png", "svg", "pdf"],
                        "description": "Output format (default: png)",
                    },
                    "output_path": {
                        "type": "string",
                        "description": "Optional file path to save the output (relative to mounted /output directory)",
                    },
                },
                "required": ["code"],
            },
        ),
    ]


@server.call_tool()
async def call_tool(name: str, arguments: dict):
    """Handle tool calls."""

    if name == "diagrams_describe":
        category = arguments.get("category")

        if not category:
            return [TextContent(type="text", text=OVERVIEW)]

        provider = PROVIDERS.get(category)
        if not provider:
            available = ", ".join(PROVIDERS.keys())
            return [TextContent(
                type="text",
                text=f"Unknown category: {category}\n\nAvailable: {available}",
            )]

        text = f"""# {provider['name']}

## Available Modules

```
from diagrams.{category}.<module> import <Node>
```

Modules: {', '.join(provider['modules'])}

## Example

```python
{provider['example']}
```

## References

- Nodes list: https://diagrams.mingrammer.com/docs/nodes/{category}
"""
        return [TextContent(type="text", text=text)]

    elif name == "diagrams_render":
        code = arguments.get("code", "")
        output_format = arguments.get("format", "png")
        output_path = arguments.get("output_path")

        # Validate code has diagrams import
        if "from diagrams" not in code and "import diagrams" not in code:
            return [TextContent(
                type="text",
                text="Error: Code must import from the diagrams library",
            )]

        result = render_diagram(code, output_format)

        if not result["success"]:
            return [TextContent(type="text", text=f"Error: {result['error']}")]

        # Save to file if output_path is provided
        saved_path = None
        if output_path:
            output_dir = Path("/output")
            if output_dir.exists():
                # Ensure output_path has correct extension
                if not output_path.endswith(f".{output_format}"):
                    output_path = f"{output_path}.{output_format}"
                full_path = output_dir / output_path
                full_path.parent.mkdir(parents=True, exist_ok=True)
                with open(full_path, "wb") as f:
                    f.write(result["content"])
                saved_path = str(full_path)
            else:
                return [TextContent(
                    type="text",
                    text="Error: /output directory not mounted. Use: docker run -v /your/path:/output ...",
                )]

        # Return image
        content_b64 = base64.b64encode(result["content"]).decode()

        contents = []

        if saved_path:
            contents.append(TextContent(type="text", text=f"Saved to: {saved_path}"))

        if output_format == "svg":
            # SVG can be returned as text
            contents.append(TextContent(type="text", text=result["content"].decode("utf-8")))
        else:
            contents.append(ImageContent(
                type="image",
                data=content_b64,
                mimeType=result["mime_type"],
            ))

        return contents

    return [TextContent(type="text", text=f"Unknown tool: {name}")]


async def main():
    """Run the MCP server."""
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, server.create_initialization_options())


if __name__ == "__main__":
    asyncio.run(main())
