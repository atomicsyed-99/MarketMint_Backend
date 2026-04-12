# Shopify Multi-App Registry Design

## Context

MarketMint's public Shopify app ("MarketMint (Beta)", `client_id = 6630400c4ffc218cc63263c07c9b8244`, configured in `marketmint-products-service/shopify.app.toml`) is not yet approved by Shopify, which means it cannot be installed on production stores via the standard public-app OAuth flow. The blocking error is:

> "This app needs to be reviewed by Shopify before it can be installed."

This restriction applies to all public apps (listed or unlisted) created in either the legacy Partner Dashboard or the new Dev Dashboard. There is no "skip review" option.

The unblocked path is **custom apps in the Dev Dashboard**: each client adds MarketMint as an "App developer" member of their Shopify organization, then MarketMint creates a **custom app** (not public) inside that client's organization. Custom apps do not require Shopify review and can be installed on any store within the same organization. Each custom app has its own `client_id` and `client_secret`.

Two backend services need to support **N distinct Shopify apps**, one per client:

- **`marketmint-pro-cowork`** (this repo) — uses `nangoProxy` to call Shopify Admin API from agent tools. Currently uses a single `provider_config_key: "shopify"` in the connector registry.
- **`marketmint-products-service`** — Fastify backend that handles product sync, image ingestion, OAuth callback, and webhooks. Currently uses `env.NANGO_INTEGRATION_ID` (single hardcoded key) in `src/services/nango.ts` and reads raw access tokens via `nango.getToken(integrationId, connectionId)` to call Shopify directly.

Both services share the same Postgres and the same Nango self-hosted instance. The current single-integration model in both cannot represent N apps.

## Goals

- Allow MarketMint to register an arbitrary number of per-client Shopify apps
- Route each workspace's Shopify connection through that workspace's specific app credentials
- Keep credentials in Nango only (no `client_secret` in MarketMint Postgres)
- Make the registration flow programmatic so onboarding a new client is one admin endpoint call
- Keep the rest of the connector system (system prompt, tool factories, search_tools, chat route) generic — only Shopify-specific paths are touched
- Support both Path B (MarketMint creates the app inside client's org) and Path H (client creates the app and gives MarketMint credentials) using the same code

## Non-Goals (V1)

- **Multi-store per workspace.** Workspaces are 1:1 with stores in V1. If a workspace tries to connect a second store, the system returns an explicit error and points the user to use a separate workspace. Multi-store is a V2 concern; the schema includes `store_domain` as a nullable forward-compat column so V2 can add it without a migration.
- **Per-store routing within a workspace.** All Shopify connections in a workspace use the same registered app.
- **Encryption-at-rest of credentials in MarketMint Postgres.** We don't store credentials in our Postgres at all. Nango is the source of truth for `client_secret` and `access_token`.
- **Auto-rotation of `client_secret`.** Manual via the admin endpoint. MarketMint can update the integration in Nango via the same endpoint with new credentials.
- **Self-service client onboarding UI.** V1 ships an admin endpoint only. A UI is a follow-up.

## Source of Truth

| Concern | Source of Truth |
|---|---|
| `client_id` and `client_secret` | Nango (one integration per client, keyed by `provider_config_key`) |
| `workspace_id → provider_config_key` mapping | MarketMint Postgres (`shopify_apps` table) |
| Active OAuth `access_token` | Nango (per Nango connection) |
| `workspace_id → connection_id` | Nango (filtered by `end_user_id` tag); `user_connections` table mirrors this |

## Architecture

### Data Model: `shopify_apps` table

```sql
CREATE TABLE public.shopify_apps (
  workspace_id          text PRIMARY KEY,
  provider_config_key   text NOT NULL UNIQUE,
  app_name              text NOT NULL,
  client_id_last4       text,
  store_domain          text,                       -- nullable, forward-compat metadata
  scopes                text[] NOT NULL DEFAULT '{}',
  status                text NOT NULL DEFAULT 'active'
                          CHECK (status IN ('pending', 'active', 'failed', 'deleting')),
  disabled_at           timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  created_by            text NOT NULL,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX shopify_apps_workspace_active_idx
  ON public.shopify_apps (workspace_id)
  WHERE disabled_at IS NULL;
```

**Field semantics:**

- `workspace_id` — Clerk org ID. Primary key. One row per workspace at a time (enforced by the partial unique index since soft-deleted rows can coexist with the active one).
- `provider_config_key` — The Nango integration key (e.g. `shopify-acme-7f3a2b`). Must match the key in Nango. Globally unique. Shape enforced by `SHOPIFY_PER_CLIENT_KEY_PATTERN` (see registry changes below).
- `app_name` — Human-readable label (e.g. "ACME Shopify App"). For support and admin UI display.
- `client_id_last4` — Last 4 characters of the OAuth `client_id`. NOT the full client_id, NOT the secret. Used for support identification when a client says "we rotated app credentials" — operators can confirm which app row corresponds to which Shopify Dev Dashboard app.
- `store_domain` — Forward-compat metadata. Nullable in V1. When V2 adds multi-store, this becomes part of the routing key.
- `scopes` — Shopify OAuth scopes the app was created with. Used by the admin endpoint to populate the Nango integration; not used at runtime.
- `status` — Lifecycle state for the two-phase commit against Nango. `active` is the only state visible to runtime lookups; `pending` / `failed` / `deleting` are operator/reconcile states. Detailed transitions are in the Admin POST/DELETE endpoint sections.
- `disabled_at` — Soft-delete marker. NULL = active (in the partial-index sense). Setting this hides the row from the partial unique index while preserving history.
- `created_at`, `created_by`, `updated_at` — Audit trail.

**Why workspace-scoped PK:** routing by `workspace_id` is the simplest model that matches V1's 1:1 workspace-to-store assumption. The Clerk `orgId` is known at every step (auth middleware, chat route, connect-session route). It also matches how `user_connections` already keys by workspace.

**Why partial unique index:** lets soft-deleted rows accumulate (audit trail) while guaranteeing one active app per workspace. If a client rotates apps, the old row is soft-deleted and a new row is inserted; both stay in the table. Pending and failed rows also occupy the slot (they have `disabled_at IS NULL`), so a second provisioning attempt cannot race against a stuck first attempt.

### Connector Definition Changes

The `CONNECTORS` registry in `src/connectors/registry.ts` keeps a single Shopify entry. Its `provider_config_key: "shopify"` becomes a **canonical id**, not the actual Nango key used at runtime. Two helper functions change behavior:

```typescript
// src/connectors/registry.ts

// Strict pattern for per-client Shopify app keys generated by the admin endpoint:
//   shopify-{slug}-{6-char-random}
// slug = lowercase alphanumeric, length >= 1
// rand = exactly 6 lowercase alphanumeric chars
// Rationale: a loose `startsWith("shopify-")` check would incorrectly match any
// provider key beginning with that prefix (e.g. a future `shopify-partner`
// integration or a typo'd key). Locking the shape to the admin endpoint's slug
// format keeps the routing deterministic and auditable.
export const SHOPIFY_PER_CLIENT_KEY_PATTERN = /^shopify-[a-z0-9]+-[a-z0-9]{6}$/;

export function getConnectorByProviderKey(key: string): ConnectorDefinition | undefined {
  // Direct exact match wins for everything, including the canonical "shopify"
  const direct = CONNECTORS.find(c => c.providerConfigKey === key && c.enabled);
  if (direct) return direct;
  // Shopify multi-app: only recognized slug-shaped keys resolve to the canonical connector
  if (SHOPIFY_PER_CLIENT_KEY_PATTERN.test(key)) {
    return CONNECTORS.find(c => c.id === "shopify" && c.enabled);
  }
  return undefined;
}
```

The `Connections` map keyed by `provider_config_key` is normalized to canonical ids (so the system prompt, search_tools, and tool factories see `connections.shopify` regardless of which actual `shopify-*` key Nango stored). The actual `provider_config_key` lives inside `ConnectionInfo.providerConfigKey` and is what `nangoProxy` uses at call time.

**Keys that don't match the pattern** (e.g. legacy `shopify-legacy`, operator-typed `shopify-test`) are treated as unknown and ignored by the connector routing layer. If an operator needs such a key to work, they must either (a) follow the slug format enforced by the admin endpoint, or (b) add it as a dedicated `ConnectorDefinition` in the registry.

### Tool Factory Signature Change

The current Shopify tool factory hardcodes `"shopify"` as the `provider_config_key` argument to every `nangoProxy` call across 8 sub-files (~60 tools). This must become dynamic.

**Change:**

```typescript
// Before
toolFactory: (connectionId) => createShopifyConnectorTools(connectionId)

// After
toolFactory: (connectionId, _apiKeys, providerConfigKey) =>
  createShopifyConnectorTools(connectionId, providerConfigKey)
```

The `ConnectorDefinition.toolFactory` type signature gains a **required** third parameter `providerConfigKey: string`. This is deliberate: making it optional would let a caller forget to thread the dynamic key through and silently fall back to `"shopify"`, which would route every per-client workspace's Shopify calls through the (unapproved) canonical integration and fail with a Shopify-side permission error that's hard to diagnose. A required parameter means TypeScript fails the build if any call site is missing it.

Non-Shopify connectors ignore the argument (they have a single integration key baked into their factory). `buildAllConnectorTools` passes `info.providerConfigKey` from each connection — this value is always populated, so there is no `undefined` case to handle.

Inside the Shopify tool files, every `nangoProxy("shopify", connectionId, ...)` call becomes `nangoProxy(providerConfigKey, connectionId, ...)`. The factory closes over `providerConfigKey` at construction time, so every tool that the factory produces already knows the correct key.

**Refactor mechanics:** this is a mechanical search-and-replace across `src/connectors/tools/shopify/{products,orders,customers,inventory,collections,discounts,draft-orders,misc}.ts`. The recommended approach in the implementation plan:

1. Add `providerConfigKey: string` as a required parameter to every `create*Tools(connectionId, ...)` factory in the 8 sub-files.
2. Replace `nangoProxy("shopify", ` with `nangoProxy(providerConfigKey, ` — scope the search to `src/connectors/tools/shopify/` to avoid touching unrelated code.
3. Update `src/connectors/tools/shopify/index.ts`'s `createShopifyConnectorTools` to accept `providerConfigKey` and forward it to every sub-factory.
4. Run `tsc --noEmit` to surface any missed call site. Non-optional typing guarantees compile-time coverage.

A codemod script is optional polish — the change is small enough (~60 call sites in 8 files) that a single `sed`/`ripgrep` replace plus a build check is sufficient.

### Connect Session Flow

`POST /api/cowork/connectors/connect-session` currently hardcodes the integration key when the integrationId is `"shopify"`. New behavior:

1. Resolve workspace from Clerk auth (`user.orgId`)
2. If `integrationId` is `"shopify"`:
   - Look up `shopify_apps` row by `workspace_id` where `disabled_at IS NULL AND status = 'active'` (pending/failed/deleting rows are not usable for new OAuth sessions)
   - If no row exists: return `422 { error: "No Shopify app provisioned for this workspace. Contact support." }`
   - Use the row's `provider_config_key` for `nango.createConnectSession({ allowed_integrations: [provider_config_key] })`
3. For all other integrations: behavior unchanged
4. Response includes the resolved `provider_config_key` so the frontend knows which key to pass to `nango.auth()`

**Single-store guard (best-effort + reconcile):** the guard against accidental second-store overwrites runs in two places, because a pure pre-session check is racy:

1. **Pre-session best-effort check.** Before calling `nango.createConnectSession`, run `getUserConnections(workspaceId)` and look for an existing Shopify connection. If one exists, return `409 { error: "This workspace already has Shopify connected. Disconnect first or use a separate workspace." }`. This catches the common case: a user clicks "Connect Shopify" while another store is already linked.

2. **Post-OAuth reconcile.** Two concurrent OAuth flows started within the same session window can both pass step 1 and both succeed in Nango, leaving two active Shopify connections for the same workspace. To catch this, the Nango webhook handler for `auth.created` (already wired up in the products service, which owns the Shopify OAuth callback) runs a reconcile step:

   - On `auth.created` for any key matching `SHOPIFY_PER_CLIENT_KEY_PATTERN` (or exactly `"shopify"`), call `nango.listConnections({ tags: { end_user_id: workspace_id } })` and count active Shopify-shaped connections.
   - If count > 1: keep the most recently created connection, delete the older ones via `nango.deleteConnection`, and log a warning with both connection ids and the workspace id so the operator can follow up with the affected client.
   - Do not surface this to the end user — the frontend already shows the latest connection, and the reconcile is fast enough (<1s) to complete before the user reopens the connections page.

This is explicitly **best-effort + eventually-consistent**, not strict. True strict enforcement would require a DB-level "connect in progress" row with a TTL lock, which adds substantial complexity for a failure mode that is already rare (a user would need two tabs open starting OAuth within a few seconds of each other). The reconcile path is documented in the implementation plan's test strategy as a required integration test.

**Why no canonical-app fallback here (vs. products service):** the cowork connect-session creates **new** OAuth connections. Falling back to the canonical `shopify` integration would just produce a Shopify-side rejection ("This app needs to be reviewed") because the public app isn't approved. A 422 with a clear "contact support" message is more helpful than letting the user start an OAuth flow that's guaranteed to fail. The products service's nango.ts can fall back because it's serving *existing* connections that were authed against the canonical integration before this design landed.

### Listing & Routing Connections

`getUserConnections(workspaceId)` already pulls from Nango's `listConnections` filtered by the `end_user_id` tag. The only change is normalization on the way out:

```typescript
const connector = getConnectorByProviderKey(conn.provider_config_key);
const mapKey = connector ? connector.id : conn.provider_config_key;
connections[mapKey] = {
  providerConfigKey: conn.provider_config_key, // actual Nango key, e.g. "shopify-acme-7f3a"
  connectionId: conn.connection_id,
};
```

Now `connections.shopify.providerConfigKey` carries the dynamic key. The system prompt builder, `buildAllConnectorTools`, search_tools indexing, and disconnect handler all keep working without further changes — they iterate the map by canonical id, then read the actual key from `ConnectionInfo` when they need to call Nango.

### Admin Endpoint: `POST /api/cowork/admin/shopify-apps`

Provisions a new client app. Uses a **DB-first two-phase commit** pattern to avoid orphan Nango integrations: the row lands in `pending` state before any Nango call, and is promoted to `active` only after Nango confirms the integration exists. A reconcile job cleans up stuck `pending` rows.

**Auth:** locked to a **service token** via `Authorization: Bearer ${ADMIN_API_TOKEN}` header for V1. Rationale:

- The admin endpoint is an operator tool, invoked by a human running a CLI or Postman call after receiving credentials from a client over a secure channel. It is never called from a user-facing flow.
- A service token is stateless, easy to rotate (one env var per environment), and does not depend on Clerk's JWT machinery — which matters because the endpoint may eventually be invoked from a CI/CD cron or an ops script that has no Clerk session.
- A Clerk admin-role check was considered and rejected: it ties admin access to user accounts that could be compromised or leave the company, and it requires every ops script to bootstrap a Clerk session.
- The token is stored in the runtime env (`ADMIN_API_TOKEN`), validated at startup by `src/env.ts`, and never logged.
- The middleware rate-limits the endpoint to 10 requests/minute per IP and writes an audit log entry (`{ timestamp, ip, workspace_id, action, result }`) to `console.log` structured output for every call (success or failure). The audit trail is part of the existing log pipeline — no new infrastructure.

**Status lifecycle for this endpoint:** the `status` column declared in the Data Model section enables the two-phase commit. Both `pending` and `active` rows occupy the partial-unique-index slot (via `disabled_at IS NULL`), so a second provisioning attempt returns 409 even if the first is still in `pending`. Only `active` rows are visible to the runtime connect-session handler.

**Request:**

```json
{
  "workspace_id": "org_39yM1wOWUUfA4gcAKylcf32knFj",
  "app_name": "ACME Shopify App",
  "client_id": "shp_abc123...",
  "client_secret": "shpss_xyz789...",
  "scopes": ["read_products", "read_orders", "write_products"],
  "store_domain": "acme.myshopify.com"
}
```

**Behavior:**

1. Validate input via Zod schema (in `src/schemas/admin-shopify-apps.ts`).
2. Check no active or pending row exists for `workspace_id` (both count as occupying the slot). If one exists, return `409 { error: "Workspace already has a Shopify app provisioned or in-progress" }`.
3. Generate `provider_config_key`: `shopify-{slug(app_name)}-{6-char-random}` (e.g. `shopify-acme-7f3a2b`). Slug is lowercase alphanumeric only, matching `SHOPIFY_PER_CLIENT_KEY_PATTERN`.
4. **Insert the row in `pending` state first**, inside a transaction:
   ```sql
   INSERT INTO shopify_apps
     (workspace_id, provider_config_key, app_name, client_id_last4, store_domain, scopes, status, created_by)
   VALUES (..., 'pending', $admin_user);
   ```
   Use `client_id_last4 = client_id.slice(-4)`. NEVER store the full id or the secret.
5. Call `nango.createIntegration({ provider: "shopify", unique_key: provider_config_key, oauth_client_id: client_id, oauth_client_secret: client_secret, oauth_scopes: scopes.join(",") })`.
6. On success, update the row: `UPDATE shopify_apps SET status = 'active', updated_at = now() WHERE workspace_id = $1 AND status = 'pending'`.
7. On Nango failure, attempt compensation: `UPDATE shopify_apps SET status = 'failed', updated_at = now() WHERE workspace_id = $1 AND status = 'pending'` — but note: we **keep** the failed row (we don't delete it) so the reconcile job and the operator both have visibility into the failure. The row occupies the workspace slot until the operator manually resolves it (via DELETE admin endpoint or a new provisioning attempt after DELETE). Return `502` with the Nango error message.
8. Return `200 { provider_config_key, app_name, store_domain, status: "active" }`.

**Why DB-first:** the previous "Nango first, then DB" order had a terminal failure mode — if the DB insert failed after Nango succeeded, we ended up with an orphan Nango integration and no record of it in our own database. That orphan is invisible to the cowork code (no row to look up) and could only be cleaned by an operator who noticed it in the Nango admin UI. DB-first flips the failure modes: if Nango fails, we have a `pending`/`failed` row that's easy to find and operator-visible; if the DB update-to-active fails (process crash between step 5 and 6), we have a `pending` row **and** a real Nango integration, which the reconcile job detects and fixes.

**Reconcile job:** a scheduled task (Trigger.dev cron, every 15 minutes) finds `shopify_apps` rows in `pending` status older than 5 minutes and:

- Calls `nango.getIntegration(row.provider_config_key)`.
- If Nango reports the integration exists: promote the row to `active` (the process crashed between steps 5 and 6).
- If Nango reports it does not exist: promote the row to `failed` with a log entry (the operator can decide to retry by DELETE + re-POST).
- If Nango is unreachable: leave the row alone, log the error, and let the next cron tick retry.

The reconcile job is idempotent and safe to run concurrently with fresh provisioning attempts because it only acts on rows older than 5 minutes.

**Why `status = 'failed'` instead of row deletion on compensation failure:** deletion would hide the failure from the operator and potentially allow a second provisioning attempt to race with a half-cleaned-up Nango integration. Keeping the row visible (but not blocking new provisioning forever — operator runs DELETE to clear it) is more auditable.

**Runtime lookup rule:** the connect-session handler filters `status = 'active' AND disabled_at IS NULL`. Pending/failed/deleting rows are invisible to the runtime but still occupy the partial-unique-index slot, so they correctly block a second provisioning attempt.

### Admin Endpoint: `DELETE /api/cowork/admin/shopify-apps/:workspace_id`

Tears down a provisioned app. Uses a **status-first teardown** pattern symmetric to the POST endpoint: the row is marked `deleting` before any external call, so a failure mid-teardown leaves a row that the reconcile job can see and clean up, and so the runtime lookup stops finding the row immediately (no new OAuth sessions can use a key that's being torn down).

**Behavior:**

1. Look up `shopify_apps` row by `workspace_id` where `disabled_at IS NULL`. If none, return `404 { error: "No active Shopify app for workspace" }`.
2. **Mark the row `deleting` first**, inside a transaction:
   ```sql
   UPDATE shopify_apps
   SET status = 'deleting', updated_at = now()
   WHERE workspace_id = $1 AND disabled_at IS NULL AND status = 'active'
   RETURNING provider_config_key;
   ```
   If the `UPDATE` affects zero rows (the row was concurrently deleted or is already in `deleting`/`pending`/`failed`), return `409 { error: "App is not in an active state" }`. This also eliminates the connect-session handler's window — because the handler filters `status = 'active'`, once we mark `deleting` it can no longer resolve this row for new sessions.
3. Invalidate caches **immediately** after the status flip: `invalidateConnectionsCache(workspace_id)` and `invalidateProcessorCache(workspace_id)`. This is done early so any in-flight chat requests observe the flipped state on their next reads.
4. List active Nango connections for that workspace: `nango.listConnections({ tags: { end_user_id: workspace_id } })`. For each connection where `provider_config_key === row.provider_config_key`, call `nango.deleteConnection(provider_config_key, connection_id)`. Collect any errors but don't abort on partial failures — log the failed connection ids.
5. Call `nango.deleteIntegration(provider_config_key)`. This is idempotent against `not found`.
6. Finalize the soft-delete: `UPDATE shopify_apps SET disabled_at = now(), updated_at = now() WHERE workspace_id = $1 AND status = 'deleting'`. The row is now fully retired; a subsequent POST for the same workspace can insert a fresh row because the partial unique index only covers `disabled_at IS NULL`.
7. Return `200 { success: true, deleted_connections: N }`.

**Failure handling:**

- If step 4 fails mid-loop (some connections deleted, some not): the row stays in `deleting` status, the reconcile job sees it on the next cron tick and retries from step 4. Nango operations are idempotent against missing resources, so retries are safe.
- If step 5 fails (Nango `deleteIntegration` errors): same as above — reconcile retries. An orphan `deleting` row with no Nango integration is resolved by skipping step 5 on the retry (reconcile checks `nango.getIntegration` first).
- If step 6 fails (extremely rare, post-Nango): row remains in `deleting` with no Nango resources. Reconcile promotes it to `disabled_at = now()` directly.

**Reconcile coverage:** the same cron job that handles stuck `pending` rows (from the POST endpoint) also handles stuck `deleting` rows older than 5 minutes. For each, it verifies Nango state and drives the row to its terminal state (`disabled_at` set).

Order is deliberate: DB state flip first (stops new usage), then cache invalidation (propagates the flip), then connections (so they can't outlive the integration), then integration, then final soft-delete. Every step is idempotent.

### Products Service Integration

`MarketMint-products-service` runs as a separate Fastify backend that owns the Shopify OAuth callback, webhook receivers, product sync, and image ingestion pipelines. It currently calls Nango via a single hardcoded integration key and pulls raw access tokens to call Shopify directly. It must adopt the same `shopify_apps` lookup, but the surface is small.

**Current `src/services/nango.ts`:**

```typescript
// Hardcoded single integration
allowed_integrations: [env.NANGO_INTEGRATION_ID]
// Token fetch
const token = await nango.getToken(env.NANGO_INTEGRATION_ID, connection.connection_id);
```

**New behavior:**

1. Add a query helper `getShopifyAppForWorkspace(workspaceId)` that reads the same `shopify_apps` table this design creates. The products service shares the Postgres but does NOT import from `MarketMint-pro-cowork` (no shared package exists yet). It defines its own minimal Drizzle schema for the table (read-only mirror) and runs the SELECT directly. The schema mirror is short — 9 columns, no relations needed for the read path. If a shared package is later introduced, this can collapse.
2. `createNangoOAuthUrl(...)` resolves the workspace's `provider_config_key` and uses it for `allowed_integrations` and the Nango OAuth URL path. Falls back to `env.NANGO_INTEGRATION_ID` (or canonical `"shopify"`) if no row exists, so existing public-app flow keeps working during migration.
3. `getNangoAccessTokenForWorkspace(workspaceId)` resolves the same way and passes the dynamic key to `nango.getToken(provider_config_key, connection_id)`.
4. `deleteNangoConnectionForWorkspace(workspaceId)` resolves and deletes against the dynamic key.
5. Webhook handlers (`src/services/shopify/webhooks.ts`) receive the `shop_domain` from the webhook payload and look up the workspace via the existing `shop_domain` tag — no change needed there.

**Webhook configuration note:** every per-client custom app must register the same webhook URLs (`app/uninstalled`, `customers/data_request`, etc.) when created in each client's Dev Dashboard. The admin endpoint does NOT configure webhooks for the new app — that's a manual step in the Dev Dashboard at app creation time, OR can be automated via Shopify's `webhookSubscriptionCreate` GraphQL mutation after the first OAuth completes (post-V1 polish). For V1, the operator copies the webhook config from the existing `shopify.app.toml` into each new custom app's settings.

**Token refresh note:** Shopify offline tokens do not expire, so `nango.getToken` always returns the original token. No refresh logic to update.

### Disconnect Flow (User-Initiated)

`DELETE /api/cowork/connectors/disconnect` already exists. No change needed: it works on `provider_config_key + connection_id`, and the values come from `getUserConnections` which now carries the dynamic key in `ConnectionInfo`. The handler verifies ownership against the workspace's connections (still scoped by `end_user_id` tag) and calls `nango.deleteConnection(provider_config_key, connection_id)`.

The `shopify_apps` row stays. Disconnect removes the user's connection but not the registered app — they can reconnect later without re-provisioning.

### Migration of Existing Connections

A small number of existing workspaces may already have a Shopify connection via the original single `shopify` integration in Nango. They keep working without code changes because:

- `getConnectorByProviderKey("shopify")` still returns the Shopify connector via direct match (the prefix branch is only a fallback)
- `getUserConnections` still finds them in Nango
- Tools still get `providerConfigKey: "shopify"` and call Nango with that key

When such a workspace needs to be migrated to its own app, the operator:

1. Has the user disconnect their current Shopify connection (frontend or admin tool)
2. Calls `POST /admin/shopify-apps` to provision the new app
3. Has the user reconnect — they go through OAuth fresh against the new app

No automated migration. At ~20 clients, manual is fine.

## Operational Notes

### Rollout Order (three-repo coordination)

This design touches three repos that share the same Postgres. The rollout sequence matters: if the cowork code ships before the products service knows about `shopify_apps`, OAuth callbacks will fail for per-client apps. The safe order is:

1. **`MarketMint-products-service` — fallback-only awareness.** Ship the products service update that adds the read-only `shopify_apps` schema mirror and wires `getActiveShopifyAppForWorkspace` into `createNangoOAuthUrl`, `getNangoAccessTokenForWorkspace`, `deleteNangoConnectionForWorkspace`, and `findNangoConnection` — but with the fallback branch hit every time (because no rows exist yet). Behavior is identical to today; the code is just shaped to look up the table. Deploy and verify no regression on existing canonical-app workspaces.

2. **`MarketMint-pro-cowork` — DB migration only.** Run the Drizzle migration that creates `shopify_apps`. No code change yet. The products service picks up the table but finds no rows, so it continues using the canonical fallback. Verify by running `\d shopify_apps` in Postgres and confirming the products service still handles existing connections correctly.

3. **`MarketMint-pro-cowork` — code changes.** Ship the connector registry changes, tool factory signature change, connect-session handler, and both admin endpoints. At this point the cowork service understands per-client apps but none are provisioned yet — all Shopify flows still resolve to the canonical key. Deploy.

4. **`MarketMint-ui` — dynamic provider_config_key.** Ship the frontend changes that use the `providerConfigKey` returned by the connect-session response instead of hardcoding `"shopify"`, and add the 422/409 error-handling copy. Deploy.

5. **First provisioning.** Run `POST /api/cowork/admin/shopify-apps` for the first real client. Walk through OAuth end-to-end against a Shopify dev store. Verify the full call path: connect-session → Nango → OAuth callback (products service) → first `shopify_get_shop` tool call (cowork chat).

6. **Remaining clients.** Provision the rest incrementally, one at a time for the first few, then in batches once the flow is proven.

**Rollback strategy:** each step is independently reversible because every component keeps working with zero rows in `shopify_apps`. If a problem surfaces at step 5, the operator can `DELETE` the admin row and everything reverts cleanly. If a problem surfaces at step 3, rolling the cowork code back to pre-change state still works with the migrated DB (the table is just unused).

**Lock-step warning:** do NOT let the UI change (step 4) ship before the cowork code (step 3) — the UI would pass a dynamic `providerConfigKey` from `connect-session` that the cowork handler doesn't yet return, breaking the Shopify connect button. Enforce this by gating the UI change behind the cowork deployment in the release checklist.

### Disaster Recovery

Nango is the source of truth for `client_id`, `client_secret`, and OAuth `access_token`. Losing the Nango database means losing every per-client Shopify app's credentials — unrecoverable from MarketMint Postgres alone because MarketMint never stores the secret.

**Backup policy (required before first production provisioning):**

- Nango's Postgres database (self-hosted) must be on automated daily backups with a minimum 14-day retention window.
- Backups must be tested at least monthly via a restore drill to a staging instance.
- Backups must be stored in a separate region from the primary Nango DB.

**Recovery runbook (Nango DB loss):**

1. Restore the most recent Nango DB backup to a fresh instance and point the `NANGO_SECRET_KEY`/host env vars at it in both cowork and products services.
2. For each `shopify_apps` row in cowork's DB with `status = 'active'` and `disabled_at IS NULL`, verify via `nango.getIntegration(provider_config_key)` that the integration survived the restore. Rows whose integration is missing are flagged for operator follow-up.
3. For each flagged row, the operator must contact the client and re-provision the app: the client re-shares their Shopify Dev Dashboard custom app credentials (they still have them, since the client created the custom app), and the operator runs `DELETE` + `POST` on the admin endpoint to rebuild the integration. User connections will need to be re-established via OAuth (access tokens are gone).
4. Communicate the re-consent requirement to affected clients before the restore window so they can plan downtime.

**Partial Nango outage (not DB loss):** if Nango is unreachable but the DB is intact, the cowork connect-session handler fails fast with a `503` for new connections. Existing connections continue working because `nangoProxy` has retry logic and Nango recovers transparently once back online. No special handling needed.

### Path B vs Path H — both supported

The admin endpoint accepts `client_id` and `client_secret` regardless of who created the Dev Dashboard app:

- **Path B** (recommended for less-technical clients): client adds MarketMint engineer as App developer in their Shopify org. Engineer creates the custom app, copies credentials, calls the admin endpoint.
- **Path H** (for technical clients): client creates the custom app in their own Dev Dashboard, sends credentials to MarketMint via secure channel (1Password share, etc.). Engineer calls the admin endpoint with those credentials.

The system doesn't care which path. Both result in identical registry rows.

### Security

- `client_secret` is in the request body and never persisted in MarketMint Postgres. It's forwarded to Nango via the SDK and immediately discarded.
- The admin endpoint MUST be authenticated with the `ADMIN_API_TOKEN` service token (see the Admin POST endpoint section for the full auth decision and rationale). It is NOT exposed to end users and NOT wired to any Clerk role.
- `ADMIN_API_TOKEN` is validated at startup by `src/env.ts` and must be set in every environment that runs the admin endpoint. Rotation is a one-line env var update + deploy. The token must be at least 32 characters of high-entropy random data (enforced by the Zod schema).
- The admin middleware rate-limits to 10 requests/minute per IP, which is enough for legitimate operator workflows and tight enough to blunt brute-force attempts against the token.
- Every admin endpoint call (success or failure) writes a structured audit log entry (`{ timestamp, ip, workspace_id, action, result, error }`) via the existing log pipeline. No new infrastructure.
- The admin endpoint MUST be served only over TLS in production.
- Nango is self-hosted; secret-at-rest concerns live in the Nango DB, not ours. See the Disaster Recovery subsection above for Nango backup requirements.
- Audit trail: `created_by` records which operator provisioned the app (read from a request header like `X-Admin-User` that the operator CLI sets to their name or Clerk user id). Soft-deleted rows preserve history. Combined with the structured audit log above, this gives a complete per-workspace provisioning timeline.

### Path to Approved Public App (Future)

When the public app is eventually approved, the migration is:

1. Configure the approved app once in Nango as `shopify` (the canonical key)
2. For each workspace with a per-client app, the operator chooses to either: (a) leave them on the per-client app indefinitely, or (b) disconnect, soft-delete the `shopify_apps` row, and have them reconnect via the canonical `shopify` integration
3. New workspaces can either be provisioned via the admin endpoint (per-client app) or via the canonical integration — the registry table being empty for a workspace means "use the canonical `shopify` integration"

The connect-session handler's fallback order is: per-workspace registered app first, then canonical `shopify`. This is implemented as: if `shopify_apps` lookup returns no row, fall back to `provider_config_key: "shopify"`. The 422 error described above changes from "always 422" to "422 only if neither a per-client app nor the canonical integration exists."

This means we can ship the registry now and incrementally migrate to the canonical app later without breaking changes.

## Files to Create / Modify

### `MarketMint-pro-cowork` (this repo)

#### New

| File | Purpose |
|---|---|
| `src/db/schema/shopify-apps.ts` | Drizzle schema for `shopify_apps` table including the `status` column |
| `drizzle/000X_add_shopify_apps.sql` | Drizzle migration (next sequence number, generated via `drizzle-kit generate`) |
| `src/db/queries/shopify-apps.ts` | Query helpers: `getActiveShopifyApp(workspaceId)`, `insertPendingShopifyApp(...)`, `promoteShopifyAppToActive(workspaceId)`, `markShopifyAppFailed(workspaceId)`, `markShopifyAppDeleting(workspaceId)`, `finalizeShopifyAppSoftDelete(workspaceId)`, `listStuckShopifyApps(olderThan)` |
| `src/routes/admin/shopify-apps.ts` | Admin endpoints: `POST` (two-phase commit) and `DELETE` (status-first teardown) |
| `src/schemas/admin-shopify-apps.ts` | Zod schemas for the admin request bodies; `ADMIN_API_TOKEN` length check (>=32) lives in `src/env.ts` |
| `src/middleware/admin-auth.ts` | Service-token middleware with rate limit + structured audit log |
| `src/jobs/reconcile-shopify-apps.ts` | Reconcile job (Trigger.dev cron, every 15 minutes) for stuck `pending` and `deleting` rows |

#### Modified

| File | Change |
|---|---|
| `src/db/schema/index.ts` | Export the new `shopifyApps` table |
| `src/connectors/types.ts` | `toolFactory` signature gains optional `providerConfigKey` third arg |
| `src/connectors/registry.ts` | `getConnectorByProviderKey` adds `shopify-*` prefix matching; Shopify entry's `toolFactory` passes `providerConfigKey` through |
| `src/connectors/build-toolset.ts` | `buildAllConnectorTools` passes `info.providerConfigKey` as the third arg to `toolFactory` |
| `src/connectors/nango/connections.ts` | `getUserConnections` normalizes the map key to canonical connector id; `ConnectionInfo.providerConfigKey` carries the actual Nango key |
| `src/connectors/tools/shopify/index.ts` | `createShopifyConnectorTools(connectionId, providerConfigKey)` — accept and propagate `providerConfigKey` |
| `src/connectors/tools/shopify/{products,orders,customers,inventory,collections,discounts,draft-orders,misc}.ts` | All `nangoProxy("shopify", ...)` become `nangoProxy(providerConfigKey, ...)`; factory functions accept and close over `providerConfigKey` |
| `src/routes/connectors.ts` | `connectSessionHandler` resolves workspace's app from `shopify_apps` (filter `status = 'active'`) for Shopify integrations; adds 422 error for missing app and 409 for existing connection; response body carries `providerConfigKey` for the UI |
| `src/mastra/index.ts` | Register the new admin route handlers |
| `src/env.ts` | Add `ADMIN_API_TOKEN: z.string().min(32)` to the Zod schema |

### `MarketMint-ui` (apps/MarketMint-pro)

The main frontend needs three small touch points. There is no new admin UI in V1 — admin operations are CLI/API only.

#### Modified

| File / Area | Change |
|---|---|
| Shopify connect handler (wherever `nango.auth("shopify", ...)` is called today) | Use the `provider_config_key` returned by `POST /api/cowork/connectors/connect-session` instead of hardcoding `"shopify"`. The response shape gains a top-level `providerConfigKey` field that the frontend passes into `nango.auth(providerConfigKey, { params: { subdomain } })`. |
| Connect-session error handling | Surface `422 "No Shopify app provisioned for this workspace. Contact support."` and `409 "This workspace already has Shopify connected. Disconnect first or use a separate workspace."` as user-facing toasts/dialogs with appropriate copy. |
| Connections list rendering | When iterating `GET /api/cowork/connectors/connections` results, recognize Shopify by the canonical `id === "shopify"` from `availableConnectors`, OR by `providerConfigKey.startsWith("shopify-")`. Don't compare against the literal string `"shopify"` — that'll only match the canonical integration and miss per-client apps. The simpler approach: read the `id` field, since the backend already normalizes it. |

#### Unchanged

- The existing "Connect Shopify" button, the subdomain input prompt, and the integrations panel UI all stay the same. The visible UX is identical — only the underlying `provider_config_key` is dynamic.
- No frontend changes are needed when the public app is eventually approved — the backend transparently routes between per-client and canonical apps.

### `MarketMint-products-service`

#### New

| File | Purpose |
|---|---|
| `src/db/schema/shopify-apps.ts` | Read-only Drizzle mirror of the `shopify_apps` table (defined in cowork). Same column shape, no relations. Products service never writes to this table — only reads. |
| `src/services/shopify-apps.ts` | Query helper `getActiveShopifyAppForWorkspace(workspaceId)` returning `{ providerConfigKey } \| null` |

#### Modified

| File | Change |
|---|---|
| `src/services/nango.ts` | `createNangoOAuthUrl`, `getNangoAccessTokenForWorkspace`, `deleteNangoConnectionForWorkspace`, `findNangoConnection` all resolve `provider_config_key` via `getActiveShopifyAppForWorkspace` and fall back to `env.NANGO_INTEGRATION_ID` when no row exists. The hardcoded `env.NANGO_INTEGRATION_ID` references stay in place as the fallback. |
| `src/routes/nango-webhooks.ts` (or existing webhook handler) | Add a reconcile step for `auth.created` events on Shopify keys (exact `"shopify"` match OR matches `SHOPIFY_PER_CLIENT_KEY_PATTERN`): list all active Shopify connections for the workspace; if more than one, keep the newest and delete the older(s), logging each deletion. Handles the two-concurrent-OAuth race described in the Connect Session Flow section. |
| `src/config.ts` (or env loader) | No change to env vars — `NANGO_INTEGRATION_ID` remains as the fallback for the canonical public-app integration |

#### Unchanged

- `src/services/shopify/client.ts`, `webhooks.ts`, `oauth.ts`, `sync.ts`, `ingest-image.ts` — these all receive the access token (or shop domain for webhooks) from a higher layer. They don't need to know which `provider_config_key` produced the token.
- `shopify.app.toml` — stays as the canonical public-app config, used when the public app is eventually approved or when a workspace has no per-client app row.

## Testing Strategy

### Unit tests

- `getConnectorByProviderKey`: exact match for canonical `"shopify"`, exact match for non-Shopify connectors, slug-shaped `"shopify-acme-7f3a2b"` matches via pattern, loose `"shopify-foo"` (wrong shape) returns undefined, `"shopify-partner"` returns undefined, completely unknown key returns undefined.
- `SHOPIFY_PER_CLIENT_KEY_PATTERN` regex: positive cases (`shopify-a-123abc`, `shopify-longer-slug-7f3a2b`), negative cases (`shopify-`, `shopify-foo`, `shopify-FOO-7f3a2b` uppercase, `shopify-foo-7f3a2` too short).
- `getActiveShopifyApp` query helper: returns row when `status='active'` and `disabled_at IS NULL`; returns null for pending/failed/deleting rows; returns null for soft-deleted rows.
- Shopify tool factory: every Shopify sub-factory compiles with `providerConfigKey: string` as a required positional argument (verified by `tsc --noEmit`).

### Integration tests

- `POST /admin/shopify-apps` happy path: mock Nango `createIntegration` to succeed, verify DB row transitions `pending → active`, verify response shape.
- `POST /admin/shopify-apps` Nango failure: mock `createIntegration` to throw, verify DB row is marked `failed` (not deleted), verify 502 response, verify subsequent POST to same workspace returns 409.
- `POST /admin/shopify-apps` slot collision: pre-insert an active row, verify second POST returns 409 without calling Nango.
- `POST /admin/shopify-apps` auth: verify missing/invalid `ADMIN_API_TOKEN` returns 401 and is rate-limited.
- `DELETE /admin/shopify-apps/:workspace_id` happy path: active row + one active connection + Nango integration — verify status flips to `deleting`, caches invalidated, connections deleted, integration deleted, row gets `disabled_at` set.
- `DELETE /admin/shopify-apps/:workspace_id` idempotent retry: mock `nango.deleteIntegration` to fail on first call, verify row stays in `deleting` for reconcile to pick up; mock to succeed on retry, verify final state is correct.
- `DELETE /admin/shopify-apps/:workspace_id` connect-session interaction: once status is `deleting`, verify connect-session handler returns 422 for the workspace (even though the partial-unique-index slot is still occupied).
- `connect-session` with Shopify + active app: mock `shopify_apps` lookup to return row, verify resolved `provider_config_key` is in the Nango session call AND in the response body.
- `connect-session` with no provisioned app: verify 422 error, verify no Nango call is made.
- `connect-session` with existing connection (409 guard): mock `getUserConnections` to return an active Shopify connection, verify 409 error.
- `connect-session` with `pending`/`deleting` row: verify 422 (the handler filters `status = 'active'`).

### Reconcile job tests

- `pending` row older than 5 minutes, Nango integration exists: verify reconcile promotes to `active`.
- `pending` row older than 5 minutes, Nango integration missing: verify reconcile marks `failed`.
- `deleting` row older than 5 minutes, Nango integration exists: verify reconcile retries teardown.
- `deleting` row older than 5 minutes, Nango integration missing: verify reconcile sets `disabled_at` directly.
- Nango unreachable: verify reconcile logs error and leaves rows unchanged for next cron tick.
- `pending` row younger than 5 minutes: verify reconcile ignores it (avoids racing with in-flight POST).

### Race condition / reconcile integration tests

- **Two concurrent OAuth flows**: simulate two connect-session requests from the same workspace completing within the same second. Verify the Nango `auth.created` webhook reconcile handler detects the duplicate, keeps the latest connection, deletes the older, and logs both connection ids.
- **POST endpoint interrupted between Nango create and DB promote**: simulate a crash after step 5 succeeds but before step 6 runs. Verify the `pending` row survives, the Nango integration exists, and the reconcile job on the next tick promotes the row to `active`.

### Smoke test (manual, end-to-end)

- Provision a real app via `POST /admin/shopify-apps` against a Shopify dev store (not production).
- Walk through OAuth from the UI. Verify the Nango session response contains the dynamic `providerConfigKey` and the UI passes it to `nango.auth`.
- Run a `shopify_get_shop` tool call from the chat and verify the response. Inspect the request logs to confirm the dynamic `provider_config_key` was used in the proxy call (not the canonical `"shopify"`).
- Disconnect from the UI, verify the connection is gone.
- Call `DELETE /admin/shopify-apps/:workspace_id`, verify the row is gone and the Nango integration is removed.
- Re-provision the same workspace via `POST` to confirm the slot is freed after soft-delete.

## Open Questions for the Implementation Plan

These are deferred to the writing-plans skill, not blockers for this design:

- **Admin auth mechanism choice** — service token vs Clerk admin role. Both are simple; pick the one that matches the existing operator workflow.
- **Slug generation for `provider_config_key`** — confirmed format `shopify-{slug}-{rand}`, but the slug library to use (`slugify` vs custom) is an implementation detail.
- **Where to validate Shopify scopes against a known list** — the admin endpoint accepts any scope strings; whether to validate against Shopify's documented scope list is a polish item.
