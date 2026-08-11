---
id: 01KJKX113Q0P6M0RT2KQHBBZSN
type: adr
title: Use ghcr.io for Docker package registry
requires: 01KJKWVYPT3BAHATCC72FGYQQE
created: 2026-03-01T05:13:06.423Z
updated: 2026-03-01T05:13:06.423Z
---

## Decision

Use GitHub Container Registry (ghcr.io) instead of DockerHub for publishing Docker packages.

## Implementation

### Workflow changes

`.github/workflows/docker-release.yml`:

```yaml
env:
  REGISTRY: ghcr.io

permissions:
  packages: write

steps:
  - uses: docker/login-action@v3
    with:
      registry: ghcr.io
      username: ${{ github.actor }}
      password: ${{ secrets.GITHUB_TOKEN }}
```

### Image naming

```
ghcr.io/dbgso/python-diagrams-mcp:latest
ghcr.io/dbgso/python-diagrams-mcp:1.0.0
```

### OCI labels

Added labels for source traceability:

```yaml
labels: |
  org.opencontainers.image.source=${{ github.server_url }}/${{ github.repository }}
  org.opencontainers.image.revision=${{ github.sha }}
```

## Rationale

1. **No additional secrets**: Uses GITHUB_TOKEN, no DockerHub credentials needed
2. **No rate limits**: Public images have unlimited pulls
3. **GitHub integration**: Package appears on repository page
4. **Security**: OIDC-style authentication without long-lived tokens

## Trade-offs

- Pull command is slightly longer (`ghcr.io/` prefix)
- Images don't appear in DockerHub search (not relevant for MCP tools)
