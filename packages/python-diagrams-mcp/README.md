# python-diagrams-mcp

MCP server for rendering Python [diagrams](https://diagrams.mingrammer.com/) library code.

**This is a Docker-based MCP server.** The entire server runs inside a Docker container.

## Architecture

![python-diagrams-mcp architecture](./python-diagrams-mcp-architecture.png)

## Features

- **Self-contained**: Python + diagrams + MCP server all in one Docker image
- **Multiple Providers**: AWS, Azure, GCP, Kubernetes, On-Premises, and more
- **Output Formats**: PNG, SVG, PDF
- **Guidelines**: Built-in documentation for each provider

## Prerequisites

- Docker installed and running

## Installation

### Pull from GitHub Container Registry

```bash
docker pull ghcr.io/dbgso/python-diagrams-mcp:latest
```

### Or Build Locally

```bash
cd packages/python-diagrams-mcp
docker build -t python-diagrams-mcp:latest .
```

## Usage

### MCP Configuration

Add to your MCP client configuration:

```json
{
  "mcpServers": {
    "python-diagrams": {
      "command": "docker",
      "args": ["run", "--rm", "-i", "ghcr.io/dbgso/python-diagrams-mcp:latest"]
    }
  }
}
```

### Save Output to Files

To save diagrams to files, mount a volume to `/output`:

**Important:** MCP config doesn't support shell expansion, so use a wrapper script:

```bash
#!/bin/bash
# diagrams-mcp.sh
exec docker run --rm -i \
  -v "${PWD}/output:/output" \
  --user "$(id -u):$(id -g)" \
  ghcr.io/dbgso/python-diagrams-mcp:latest
```

- `--user "$(id -u):$(id -g)"`: Runs as your user to avoid permission issues
- `${PWD}/output`: Outputs to `./output` relative to working directory

Then configure MCP:

```json
{
  "mcpServers": {
    "python-diagrams": {
      "command": "/path/to/diagrams-mcp.sh"
    }
  }
}
```

### Tools

#### `diagrams_describe`

Get guidelines for the Python diagrams library.

```typescript
// Get overview
diagrams_describe({})

// Get AWS-specific guidelines
diagrams_describe({ category: "aws" })

// Get Kubernetes guidelines
diagrams_describe({ category: "k8s" })
```

Available categories: `aws`, `gcp`, `k8s`, `onprem`

#### `diagrams_render`

Render a diagram using Python code.

```typescript
diagrams_render({
  code: `
from diagrams import Diagram
from diagrams.aws.compute import EC2

with Diagram("Simple", show=False):
    EC2("server")
`,
  format: "png",       // or "svg", "pdf"
  output_path: "diagram.png"  // optional: save to /output/diagram.png
})
```

Parameters:
- `code` (required): Python source code using the diagrams library
- `format` (optional): Output format - `png` (default), `svg`, or `pdf`
- `output_path` (optional): File path to save output (relative to `/output` mount)

## Example

```python
from diagrams import Diagram, Cluster
from diagrams.aws.compute import EC2, ECS
from diagrams.aws.database import RDS
from diagrams.aws.network import ELB

with Diagram("Web Service", show=False):
    lb = ELB("lb")

    with Cluster("Web Tier"):
        web = [EC2("web1"), EC2("web2")]

    with Cluster("App Tier"):
        app = ECS("app")

    db = RDS("db")

    lb >> web >> app >> db
```

## Development

### Release to GitHub Container Registry

Releases are automated via GitHub Actions using Changesets.

To publish a new version:

```bash
pnpm changeset
# Select python-diagrams-mcp, choose version type, add description
git add .changeset/*.md
git commit -m "chore: add changeset"
git push
```

After merging to main:
1. Version PR is created automatically
2. Merge the Version PR
3. Git tag is created (e.g., `python-diagrams-mcp-v1.0.0`)
4. Docker image is built and pushed to `ghcr.io/dbgso/python-diagrams-mcp`

No additional secrets required - uses `GITHUB_TOKEN` for authentication.

## License

MIT
