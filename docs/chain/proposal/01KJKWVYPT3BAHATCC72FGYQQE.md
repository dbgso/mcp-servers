---
id: 01KJKWVYPT3BAHATCC72FGYQQE
type: proposal
requires: 01KJKT7VHY1GR7FT9HP4JDX5QB
title: Switch Docker registry from DockerHub to ghcr.io
created: 2026-03-01T05:10:20.122Z
updated: 2026-03-01T05:12:53.365Z
content: >-
  ## 背景


  Dockerパッケージの公開先を決定する必要がある。


  ## 選択肢


  ### Option A: DockerHub


  **メリット:**

  - 知名度が高い

  - `docker pull org/image` で短いコマンド


  **デメリット:**

  - 追加シークレット必要（DOCKERHUB_USERNAME, DOCKERHUB_TOKEN）

  - Rate limit: 100 pulls/6h（匿名）

  - OIDCはBusinessプランのみ


  ### Option B: ghcr.io (GitHub Container Registry) ★推奨


  **メリット:**

  - GITHUB_TOKENで認証（追加シークレット不要）

  - Rate limit無制限（public）

  - GitHubリポジトリと統合

  - OCI labelsでソースリンク


  **デメリット:**

  - コマンドが少し長い: `docker pull ghcr.io/org/image`

  - DockerHub検索には出ない


  ## 推奨: Option B


  MCPツールはGitHubで発見されるため、DockerHub検索は問題にならない。シークレット管理の簡素化とRate
  limitの優位性からghcr.ioを推奨。
filePath: docs/chain/proposal/01KJKWVYPT3BAHATCC72FGYQQE.md
---

## Background

Need to decide where to publish Docker packages.

## Options

### Option A: DockerHub

**Pros:**
- Well-known registry
- Short pull command: `docker pull org/image`

**Cons:**
- Requires additional secrets (DOCKERHUB_USERNAME, DOCKERHUB_TOKEN)
- Rate limit: 100 pulls/6h (anonymous)
- OIDC only available on Business plan

### Option B: ghcr.io (GitHub Container Registry) - Recommended

**Pros:**
- GITHUB_TOKEN authentication (no additional secrets)
- No rate limit for public images
- Integrated with GitHub repository
- OCI labels link to source

**Cons:**
- Slightly longer command: `docker pull ghcr.io/org/image`
- Not searchable on DockerHub

## Recommendation: Option B

MCP tools are discovered via GitHub, so DockerHub search is not a concern. The simplified secret management and no rate limits make ghcr.io the better choice.
