---
"mcp-firewall": patch
---

In dry-run mode the audit log records what the rules decided, instead of `allow`.

A dry run forwards every call, and every forwarded call was written as `action: "allow"`, so a log meant to show what a rule set would do recorded denied and held calls as allowed. Forwarded calls now keep the rules' decision (`allow`, `deny` or `ask`) with `result: "executed"`, and entries made in a dry run carry `dryRun: true`. Gating is unchanged: a dry run still blocks and holds nothing.
