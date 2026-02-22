# Draft CRUD Operations Specification

Operations for managing drafts.

## Actions

### `add` - Create New Draft

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Draft identifier |
| `content` | string | Yes | Markdown content |

**Behavior:**
- Creates file at `_mcp_drafts/{id}.md`
- Fails if draft already exists
- Triggers workflow → `self_review` state

### `update` - Update Existing Draft

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Draft identifier |
| `content` | string | Yes | New markdown content |

**Behavior:**
- Overwrites existing draft content
- Fails if draft does not exist
- Resets workflow → `self_review` state

### `delete` - Delete Draft

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Draft identifier |

**Behavior:**
- Deletes draft file
- Fails if draft does not exist
- Clears workflow state

### `list` - List All Drafts

No parameters required.

**Behavior:**
- Scans `_mcp_drafts/` directory
- Returns list of draft IDs with descriptions

### `read` - Read Draft Content

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Draft identifier |

**Behavior:**
- Returns full markdown content
- Fails if draft does not exist

### `rename` - Rename Draft

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `id` | string | Yes | Current draft identifier |
| `newId` | string | Yes | New draft identifier |

**Behavior:**
- Renames draft file
- Fails if source does not exist or target exists
- Preserves workflow state

## Related

- `specification__draft-id-format` - ID naming rules
- `specification__file-structure` - Directory layout
- `specification__draft-workflow` - State transitions
