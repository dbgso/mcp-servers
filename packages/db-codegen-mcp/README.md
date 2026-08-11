# db-codegen-mcp

DB schema introspection + codegen preview as MCP tools. Reads the connected
database's catalog tables and produces JSON for `metadata.json` /
`selectable-fields.json` — the input artifacts consumed by
[`db-read-mcp`](../db-read-mcp).

Supported engines:

- PostgreSQL (`postgres://` / `postgresql://`)
- MySQL (`mysql://`)

Supported tunnels (optional, mutually exclusive):

- SSH bastion (`*_BASTION_HOST`)
- AWS SSM port forward (`*_SSM_TARGET`) — internal session managed by the MCP

When neither is configured, the MCP connects directly to the URL host.

## Setup

### 1. env file

```env
# Database URL — points at the **logical destination** of the connection.
# When a tunnel is configured (below) this is the remote endpoint the
# tunnel forwards to, not the local proxy port.
DBGEN_URL=mysql://USER:PASS@db.example.internal:3306/appdb
```

#### Alternative: per-component env vars

If the connection parts live in SSM (or Secrets Manager) as separate
parameters, set the components individually instead of pre-baking a
URL. All six required parts must be present to opt in; otherwise
`DBGEN_URL` is used as a fallback. If both are set, parts win and the
MCP logs a stderr warning so it isn't silent.

```env
DBGEN_DIALECT=postgres             # or "mysql"
DBGEN_HOST=ssm:/myapp/db/host
DBGEN_PORT=ssm:/myapp/db/port
DBGEN_USER=ssm:/myapp/db/user
DBGEN_PASSWORD=ssm:/myapp/db/password
DBGEN_DATABASE=ssm:/myapp/db/name
DBGEN_PARAMS=sslmode=require       # optional extra query string;
                                   # leading `?` is trimmed if present
```

`USER` / `PASSWORD` / `DATABASE` go through `encodeURIComponent`, so
special characters in the password (`@` `:` `/` `?` `#`) don't need to
be hand-escaped in SSM.

#### Tunnel: AWS SSM port forward (recommended for VPC-private RDS)

```env
DBGEN_SSM_TARGET=i-0123abcdef            # EC2 instance with SSM agent
DBGEN_SSM_REGION=ap-northeast-1          # optional — falls back to AWS_REGION
DBGEN_SSM_PROFILE=my-profile             # optional — falls back to AWS_PROFILE
DBGEN_SSM_DOCUMENT_NAME=...              # optional — default
                                         #   AWS-StartPortForwardingSessionToRemoteHost
DBGEN_SSM_READY_TIMEOUT_MS=15000         # optional — extend cold-start budget
```

The MCP spawns `aws ssm start-session` itself, allocates a free local port,
forwards the URL's host:port through it, rewrites the URL to
`127.0.0.1:<auto>`, then connects. Each tool call opens a fresh session;
the session is killed (SIGINT → SIGKILL fallback) when the MCP shuts down.

Requirements on the host:

- `aws` CLI on PATH.
- [`session-manager-plugin`](https://docs.aws.amazon.com/systems-manager/latest/userguide/install-plugin-verify.html)
  on PATH (the aws CLI shells out to it for port forwarding).
- IAM principal with `ssm:StartSession` on the target instance.

#### Tunnel: SSH bastion (legacy)

```env
DBGEN_BASTION_HOST=ec2-user@bastion.example
DBGEN_BASTION_KEY=~/.ssh/key.pem         # optional
DBGEN_BASTION_EXTRA_ARGS=                # optional, space-separated ssh -o flags
```

`DBGEN_BASTION_HOST` and `DBGEN_SSM_TARGET` are mutually exclusive — set
one, not both. If both are present the MCP throws on the next tool call.

#### Sharing one env file with `db-read-mcp`

`DBREAD_*` and `DBGEN_*` prefixes are intentionally distinct, so a single
env file can hold both — typical setup when you point both MCPs at the
same database:

```env
DBREAD_URL=mysql://USER:PASS@db.example.internal:3306/appdb
DBGEN_URL=mysql://USER:PASS@db.example.internal:3306/appdb

DBREAD_SSM_TARGET=i-0123abcdef
DBREAD_SSM_REGION=ap-northeast-1
DBREAD_SSM_PROFILE=my-profile

DBGEN_SSM_TARGET=i-0123abcdef
DBGEN_SSM_REGION=ap-northeast-1
DBGEN_SSM_PROFILE=my-profile
```

### 2. `.mcp.json` entry

```json
{
  "mcpServers": {
    "db-codegen-mcp-myapp": {
      "command": "sh",
      "args": [
        "-c",
        "cd /path/to/mcp-servers && exec npx tsx ./packages/db-codegen-mcp/src/index.ts --env-file /path/to/myapp.env"
      ]
    }
  }
}
```

## Tools

The MCP registers two tools (prefix fixed at `dbgen` here):

- `dbgen_describe` — list / inspect available codegen operations
- `dbgen_execute` — execute one operation

Operations are read-only on the catalog side and produce JSON previews —
they do **not** write files. The operator copies the preview output into
`metadata.json` / `selectable-fields.json` on disk.

Workflow:

1. `list_schemas` — find the namespace your tables live in
2. `list_tables` — list tables in a chosen schema
3. `introspect_table` / `introspect_all` — read columns / PK / indexes / FK
4. `preview_metadata_json` / `preview_selectable_fields_json` — generate
   preview JSON, save to disk
5. (Mandatory) Set the per-field visibility policy per the rules baked into
   `dbgen_describe`'s preamble — `selectable-fields.json` ships
   **secure-by-default** (`{ "select": "redact" }` everywhere); the operator
   flips fields to `"expose"` after an explicit audit and uses `"exclude"`
   for columns that should never reach a caller
6. `validate_selectable_fields` — cross-check the saved JSON against the
   live schema; re-run after every edit

Use `dbgen_describe` to read the full preamble (covers the four-axis PII
test, the `select` enum semantics, parallelization tips for large schemas,
etc.).

## Troubleshooting

**`Missing DB connection URL — set DBGEN_URL or pass getUrl()`**: the env
file isn't loading, the URL key isn't `DBGEN_URL`, or the per-component
set (`DBGEN_DIALECT` / `DBGEN_HOST` / `DBGEN_PORT` / `DBGEN_USER` /
`DBGEN_PASSWORD` / `DBGEN_DATABASE`) is incomplete. Verify the
`--env-file` arg points at the right file and that one form is fully
configured.

**`session-manager-plugin not found`**: install per AWS docs. The aws CLI
prints the install URL itself when the plugin is missing.

**Cold-start timeout**: SSM session establishment can take 5–15s.
`DBGEN_SSM_READY_TIMEOUT_MS` extends the budget when the default 15s
isn't enough.

**`Set at most one of *_BASTION_HOST or *_SSM_TARGET`**: env has both —
remove one.

**`ECONNREFUSED 127.0.0.1:<port>` / `ETIMEDOUT`**: tunnel didn't bind, or
the AWS-side forward to the remote host is failing. Check stderr for the
`[ssm-tunnel]` prefix lines forwarded from the aws CLI.
