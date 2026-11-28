---
id: 01M8GM8GVYHE2H0PJMMJGA6Q2H
type: implementation
title: ドリフト検査の実装
requires: 01M8GM8GVP6FS3HHSB4GCG2C8P
created: 2026-11-28T08:27:31.583Z
updated: 2026-11-28T08:27:31.591Z
baseline:
  01M8GM8GVP6FS3HHSB4GCG2C8P:
    parent: 21c3308b0328bb52
    self: 2236590ce7560a88
    at: 2026-11-28T08:27:31.582Z
code:
  - path: packages/traceable-chain-mcp/src/hash.ts
    hash: 2d0739bf9522bb71
    at: 2026-11-28T08:27:31.584Z
  - path: packages/traceable-chain-mcp/src/graph.ts
    hash: 169a436a9cf39fb9
    at: 2026-11-28T08:27:31.584Z
  - path: packages/traceable-chain-mcp/src/analysis
    hash: 46405dec2dd2fbd1
    at: 2026-11-28T08:27:31.584Z
  - path: packages/traceable-chain-mcp/src/chain-manager.ts
    hash: c0fe4f6af9cc3a03
    at: 2026-11-28T08:27:31.584Z
  - path: packages/traceable-chain-mcp/src/cli.ts
    hash: f1bc8a4851101044
    at: 2026-11-28T08:27:31.584Z
---

設計どおり実装した。テストは src/__tests__/drift.test.ts と cli.test.ts。
