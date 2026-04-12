# User Connections Table Design

## Context

Connector state currently lives only in Nango Cloud, fetched via API and cached in-memory (60s TTL). We need a persistent DB record for:
- Workspace-scoped connection sharing (all workspace members see the same connections)
- Audit trail (who connected/disconnected what, when)
- Raw Nango data dump for debugging
- Future: UI queries without hitting Nango API

## Source of Truth

**Nango is source of truth.** The DB is a persistent mirror + audit trail.

- Connect/disconnect always go through Nango first, then mirror to DB
- Chat route reads from Nango (via existing in-memory cache) — unchanged
- If DB write fails, connection still works (Nango has it)
- If Nango fails, we don't write to DB either

## Schema

### `user_connections` table

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `workspace_id` | `text` | PK (composite) NOT NULL | Clerk orgId |
| `provider_config_key` | `text` | PK (composite) NOT NULL | Nango provider key (e.g. `shopify`, `meta-marketing-api`) |
| `connection_id` | `text` | NOT NULL | Nango connection ID (may change on reconnect) |
| `connected_by_user_id` | `text` | NOT NULL | Clerk userId of who created the connection |
| `nango_raw` | `jsonb` | | Full Nango connection object dump |
| `connected_at` | `timestamp with time zone` | NOT NULL DEFAULT now() | When first connected |
| `updated_at` | `timestamp with time zone` | NOT NULL DEFAULT now() | Last updated |
| `disconnected_at` | `timestamp with time zone` | | Soft-delete: when disconnected (null = active) |
| `disconnected_by_user_id` | `text` | | Who disconnected it |

**Primary key:** `(workspace_id, provider_config_key)` — one connection per provider per workspace.

**Note on `connection_id`:** Nango may issue a new `connection_id` on reconnect. The upsert on connect overwrites it. Downstream code should not cache `connection_id` long-term — always read from this table or from Nango.

## Nango Tag Change

Switch Nango `end_user_id` tag from `userId` to `workspaceId`:

```typescript
// Before:
nango.createConnectSession({ tags: { end_user_id: userId } })
nango.listConnections({ tags: { end_user_id: userId } })

// After:
nango.createConnectSession({ tags: { end_user_id: workspaceId } })
nango.listConnections({ tags: { end_user_id: workspaceId } })
```

This ensures all workspace members share the same set of connections in Nango.

### Guard: workspaceId required

Clerk `orgId` is optional (undefined when user has no organization). All connector endpoints must guard:

```typescript
if (!user.orgId) {
  return c.json({ error: "A workspace is required to manage connections" }, 422);
}
```

This applies to: `connect-session`, `connections`, `disconnect`. The chat route should also pass `workspaceId` to `getUserConnections()` — if no workspace, return empty connections (connectors disabled for personal-scope users).

### Migration of existing Nango connections

**Assumption: zero existing production connections tagged with userId.** The connector system is new (this branch). If connections were created during development/testing with userId tags, they will become invisible after the switch. To clean up, manually delete test connections from the Nango dashboard or run:

```typescript
// One-time migration (run manually if needed):
const old = await nango.listConnections({ tags: { end_user_id: oldUserId } });
// Re-create under workspaceId tag via Nango dashboard
```

## Write Paths

### On Connect (after Nango OAuth succeeds)

1. Frontend completes OAuth via `nango.auth()`
2. Frontend calls `GET /api/v3/connectors/connections` to refresh
3. Backend fetches from Nango, upserts to `user_connections`:

```sql
INSERT INTO user_connections (workspace_id, provider_config_key, connection_id, connected_by_user_id, nango_raw)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (workspace_id, provider_config_key)
DO UPDATE SET connection_id = $3, connected_by_user_id = $4, nango_raw = $5,
             updated_at = now(), disconnected_at = NULL, disconnected_by_user_id = NULL;
```

The `disconnected_at = NULL` clears any previous soft-delete on reconnect.

### On Disconnect

Soft-delete (preserves audit trail):

```sql
UPDATE user_connections
SET disconnected_at = now(), disconnected_by_user_id = $3, updated_at = now()
WHERE workspace_id = $1 AND provider_config_key = $2;
```

Backend also calls `nango.deleteConnection()` and invalidates caches.

### Disconnect Authorization

Any workspace member can disconnect a workspace connection. The ownership check changes from "does this user own it?" to "does this user's workspace own it?":

```typescript
// Before: getUserConnections(user.id) — user-scoped
// After: getUserConnections(user.orgId) — workspace-scoped
```

## Read Paths

### Chat Route (hot path)
Unchanged — reads from Nango via `getUserConnections()` with in-memory cache. Uses `workspaceId` instead of `userId` for the Nango tag.

### Cache Key Change
Both in-memory caches (`connections.ts` and `build-toolset.ts`) must switch their key from `userId` to `workspaceId`. This ensures:
- All workspace members share one cache entry (fewer Nango API calls)
- Invalidation by one member clears for all members

### Connections List API (`GET /api/v3/connectors/connections`)
Primary: fetch from Nango (authoritative). On every list call, upsert ALL returned connections to `user_connections` (cheap, idempotent — bounded by provider count per workspace, ~6 rows max). This ensures the DB mirror stays in sync without requiring a separate sync job.

If a connection exists in the DB but NOT in Nango (e.g., deleted outside our system), it will NOT be auto-reconciled. The DB row stays until explicitly disconnected via our API. This is acceptable — the DB is a mirror, not the source of truth. Stale rows are harmless (they only affect UI listings from the DB, which is a future use case).

On reconnect, `connected_at` is intentionally preserved — it tracks when the provider was first connected. `updated_at` tracks the most recent reconnection time.

### Future UI queries
Can query `user_connections` table directly (filter `WHERE disconnected_at IS NULL` for active connections). Row count per workspace is bounded by the number of providers (~6), so no indexing on `disconnected_at` is needed initially.

## Files to Create/Modify

| File | Action |
|------|--------|
| `src/db/schema/user-connections.ts` | NEW — Drizzle table definition |
| `src/db/schema/index.ts` | MODIFY — add export |
| `src/db/queries/user-connections.ts` | NEW — upsert, softDelete, listActive queries |
| `src/connectors/nango/connections.ts` | MODIFY — switch userId → workspaceId for Nango tags + cache key |
| `src/connectors/build-toolset.ts` | MODIFY — switch cache key from userId to workspaceId |
| `src/routes/connectors.ts` | MODIFY — add workspaceId guard, upsert/softDelete DB, workspace-scoped auth |
| `src/routes/chat.ts` | MODIFY — pass workspaceId instead of userId to getUserConnections |
| `scripts/db/create-user-connections.sql` | NEW — SQL migration script (run via `node scripts/db/run-patch.mjs` or add to the script) |

## Drizzle Schema Definition

```typescript
// src/db/schema/user-connections.ts
import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const userConnections = pgTable(
  "user_connections",
  {
    workspaceId: text("workspace_id").notNull(),
    providerConfigKey: text("provider_config_key").notNull(),
    connectionId: text("connection_id").notNull(),
    connectedByUserId: text("connected_by_user_id").notNull(),
    nangoRaw: jsonb("nango_raw"),
    connectedAt: timestamp("connected_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    disconnectedAt: timestamp("disconnected_at", { withTimezone: true }),
    disconnectedByUserId: text("disconnected_by_user_id"),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.providerConfigKey] }),
  ],
);
```

Note: Uses `timestamp({ withTimezone: true })` matching `userAttachments.ts` pattern. Other existing tables (`chats`, `messages`) use bare `timestamp()` — that's a pre-existing inconsistency; new tables should use timezone-aware timestamps.

## Migration SQL

Idempotent (safe to re-run). Run via `node scripts/db/run-patch.mjs` (add to the existing script or create `scripts/db/create-user-connections.sql` and adapt the runner):

```sql
CREATE TABLE IF NOT EXISTS public.user_connections (
  workspace_id TEXT NOT NULL,
  provider_config_key TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  connected_by_user_id TEXT NOT NULL,
  nango_raw JSONB,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  disconnected_at TIMESTAMPTZ,
  disconnected_by_user_id TEXT,
  PRIMARY KEY (workspace_id, provider_config_key)
);
```

The `nango_raw` column stores the full Nango connection object for debugging. Row count per workspace is bounded by provider count (~6), so no retention policy is needed.
