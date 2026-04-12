# Shopify Multi-App Registry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let MarketMint route each workspace's Shopify OAuth connection through that workspace's own Shopify custom-app credentials (held in Nango), so clients can install MarketMint on production stores despite the public app not being approved.

**Architecture:** A new `shopify_apps` Drizzle table maps `workspace_id → provider_config_key`. A programmatic admin endpoint creates a Nango integration per client (DB-first two-phase commit), the connector registry learns to recognize slug-shaped `shopify-*` keys as the canonical Shopify connector, and the Shopify tool factory threads the dynamic `provider_config_key` through every `nangoProxy` call. The connect-session handler resolves the workspace's app and returns its dynamic key for the frontend.

**Tech Stack:** TypeScript, Hono, Drizzle ORM (Postgres), `@nangohq/node` SDK, Mastra `createTool`, Zod, Vitest. Scope of this plan: `marketmint-pro-cowork` repo only.

**Design spec:** [`docs/superpowers/specs/2026-04-06-shopify-multi-app-registry-design.md`](../specs/2026-04-06-shopify-multi-app-registry-design.md). Read that first — it explains *why* each decision was made. This plan is *how*.

**Scope note:** the spec describes changes in three repos (cowork, marketmint-ui, marketmint-products-service). This plan implements the cowork changes only. The other two repos are tracked in a "Cross-Repo Companion Work" checklist at the end for coordination, but each one needs its own separate plan in its own repo.

---

## Design Decisions Locked by This Plan

The spec left two things open. This plan commits to the following and they are **not** up for debate during execution — if you disagree, change the plan before running it, don't improvise mid-task.

### D1. Strict 422 on missing `shopify_apps` row (no canonical fallback in V1)

When a workspace calls `POST /connectors/connect-session` with `integrationId: "shopify"` and has no active row in `shopify_apps`, the handler returns `422 "No Shopify app provisioned for this workspace. Contact support."` with **no fallback** to the canonical `"shopify"` integration.

**Why:** the spec's §"Path to Approved Public App" subsection describes a *future* state where the public app is approved and can serve as a fallback. In the current state, the canonical `"shopify"` integration is the unapproved public app — falling back to it would just kick off an OAuth flow that Shopify rejects with "This app needs to be reviewed", which is a worse UX than a clear 422 with a support pointer. The spec's §Connect Session Flow (the normative section for this endpoint's V1 behavior) explicitly says 422. When the public app is eventually approved, the handler gains a fallback branch — that's a one-line follow-up, not part of this plan.

**Operator impact:** existing workspaces that were already connected to the canonical `"shopify"` integration keep working on the tool-call path (their connection in Nango is still valid). But if they disconnect and try to *reconnect*, they hit the 422. The operator must provision them a per-client app via `POST /admin/shopify-apps` before they can reconnect. This is documented in the spec's §Migration section and is acceptable because the number of such workspaces is small (~single digits).

### D2. Credential rotation = DELETE + POST (no PATCH endpoint in V1)

The spec's §Non-Goals mentions "Auto-rotation of `client_secret` is manual via the admin endpoint." The plan implements rotation as two separate admin calls: `DELETE /admin/shopify-apps/:workspace_id` to tear down the old integration, then `POST /admin/shopify-apps` with the new credentials to provision a fresh row.

**Why:** a dedicated PATCH endpoint would need to call Nango's `updateIntegration`, handle partial failure (new creds saved in Nango but old DB metadata still there), invalidate in-flight connections, and ensure idempotency against concurrent rotation attempts. Every one of those concerns is already solved by the DELETE + POST path — the existing status-first teardown and two-phase commit paths handle rotation cleanly as two well-tested operations.

**Operator runbook for rotation:**
1. `DELETE /admin/shopify-apps/:workspace_id` — tears down old Nango integration and existing user connections.
2. Notify the client that their users will need to reconnect.
3. `POST /admin/shopify-apps` with the new `client_id` / `client_secret`.
4. Users reconnect via the UI using the new provider key.

If V2 needs zero-downtime rotation, a PATCH endpoint can be added as a separate plan.

---

## File Structure

### New files (cowork)

| File | Responsibility |
|---|---|
| `src/db/schema/shopify-apps.ts` | Drizzle table definition for `shopify_apps`, including the `status` column and partial unique index on `(workspace_id) WHERE disabled_at IS NULL`. |
| `src/db/queries/shopify-apps.ts` | All reads and writes against `shopify_apps`: `getActiveShopifyApp`, `getAnyActiveOrPendingShopifyApp`, `insertPendingShopifyApp`, `promoteShopifyAppToActive`, `markShopifyAppFailed`, `markShopifyAppDeleting`, `finalizeShopifyAppSoftDelete`, `listStuckShopifyApps`. |
| `src/schemas/admin-shopify-apps.ts` | Zod schemas for the POST body, DELETE path param, and internal types. |
| `src/middleware/admin-auth.ts` | Service-token middleware that validates `Authorization: Bearer ${ADMIN_API_TOKEN}`, rate-limits to 10 req/min per IP, and writes a structured audit log entry for every call. |
| `src/routes/admin/shopify-apps.ts` | Two Hono handlers: `POST` (DB-first two-phase commit) and `DELETE` (status-first teardown). |
| `src/jobs/reconcile-shopify-apps.ts` | Reconcile function for stuck `pending` and `deleting` rows. Exports `runReconcile()` which is invoked by the Trigger.dev scheduled task. |
| `src/trigger/reconcile-shopify-apps.ts` | Trigger.dev `schedules.task` wrapper that calls `runReconcile()` every 5 minutes. Follows the same pattern as `src/trigger/agent-job-executor.ts`. |
| `src/connectors/__tests__/registry.test.ts` | Unit tests for `getConnectorByProviderKey` and the slug regex. |
| `src/db/queries/__tests__/shopify-apps.test.ts` | Unit tests for query helpers (pure SQL-level behavior, mocked `db`). |
| `src/routes/admin/__tests__/shopify-apps.test.ts` | Integration tests for the admin endpoints (mocked Nango client). |
| `src/routes/__tests__/connectors-shopify.test.ts` | Integration tests for `connectSessionHandler` with the new Shopify resolution logic. |
| `src/jobs/__tests__/reconcile-shopify-apps.test.ts` | Unit tests for the reconcile function. |
| `drizzle/0006_<generated_name>.sql` | Drizzle-generated migration creating the new table. Exact filename comes from `drizzle-kit generate`. |

### Modified files (cowork)

| File | Change |
|---|---|
| `src/env.ts` | Add `ADMIN_API_TOKEN: z.string().min(32).optional()`. Optional so dev/test environments without the token still boot; the admin middleware returns 503 when unset. |
| `src/db/schema/index.ts` | Re-export `shopify-apps` schema. |
| `src/connectors/types.ts` | `ConnectorDefinition.toolFactory` gains a required third parameter `providerConfigKey: string`. |
| `src/connectors/registry.ts` | Add `SHOPIFY_PER_CLIENT_KEY_PATTERN` regex. Update `getConnectorByProviderKey` to fall back to the pattern match. Update the Shopify entry's `toolFactory` to pass `providerConfigKey` through. Update all non-Shopify entries' `toolFactory` signatures to accept (but ignore) the new third parameter. |
| `src/connectors/build-toolset.ts` | `buildAllConnectorTools` passes `info.providerConfigKey` as the third arg to `connector.toolFactory(...)`. |
| `src/connectors/nango/connections.ts` | In `getUserConnections`, normalize the map key to `connector.id` (canonical) when a connector matches, fall back to raw `provider_config_key` otherwise. The `ConnectionInfo.providerConfigKey` field continues to carry the actual Nango key. |
| `src/connectors/tools/shopify/index.ts` | `createShopifyConnectorTools(connectionId, providerConfigKey)` — accept and thread `providerConfigKey` to every sub-factory. |
| `src/connectors/tools/shopify/products.ts` | Factory signature gains `providerConfigKey`; every `nangoProxy("shopify", ...)` becomes `nangoProxy(providerConfigKey, ...)`. |
| `src/connectors/tools/shopify/orders.ts` | Same change. |
| `src/connectors/tools/shopify/customers.ts` | Same change. |
| `src/connectors/tools/shopify/inventory.ts` | Same change. |
| `src/connectors/tools/shopify/collections.ts` | Same change. |
| `src/connectors/tools/shopify/discounts.ts` | Same change. |
| `src/connectors/tools/shopify/draft-orders.ts` | Same change. |
| `src/connectors/tools/shopify/misc.ts` | Same change. |
| `src/schemas/connectors.ts` | `ConnectSessionBodySchema` unchanged. Add a response-shape type (`ConnectSessionResponse`) so the handler and tests share one type for `{ sessionToken, providerConfigKey }`. |
| `src/routes/connectors.ts` | In `connectSessionHandler`, when resolving `"shopify"`: look up `getActiveShopifyApp(workspaceId)`, return 422 if missing, return 409 if an existing Shopify connection exists, pass the resolved key to `createConnectSession`, and include `providerConfigKey` in the response. |
| `src/mastra/index.ts` | Register `POST /cowork/admin/shopify-apps` and `DELETE /cowork/admin/shopify-apps/:workspace_id` behind `adminAuthMiddleware`. |

---

## Implementation Phases

Phases are designed so each one ends on a green build with new passing tests, and each phase can be reviewed independently. Tasks inside a phase should be completed in order.

- **Phase 1 — Type plumbing:** make `providerConfigKey` a required positional argument across the Shopify tool factory without changing any runtime behavior. At the end of this phase, the code compiles and all existing tools still work the same way, but the signature change is done once and for all.
- **Phase 2 — Registry & connections normalization:** teach the connector registry about slug-shaped Shopify keys and normalize the `Connections` map key.
- **Phase 3 — Database layer:** create the `shopify_apps` table, Drizzle schema, and query helpers.
- **Phase 4 — Admin endpoint (POST):** build the DB-first two-phase commit flow with the service-token middleware.
- **Phase 5 — Admin endpoint (DELETE):** build the status-first teardown flow.
- **Phase 6 — Connect-session integration:** wire the new lookup into the existing chat/connect flow so real OAuth sessions use the dynamic key.
- **Phase 7 — Reconcile job:** implement the cleanup function for stuck rows (Task 7.1) and wire it to a Trigger.dev 5-minute cron (Task 7.2).
- **Phase 8 — Final wiring & verification:** register routes (Task 8.1), run the quality gate — tsc + test + build + grep (Task 8.2), manual runtime smoke test (Task 8.3).

---

## Phase 1 — Tool factory signature is required

### Task 1.1: Update `ConnectorDefinition.toolFactory` type

**Files:**
- Modify: `src/connectors/types.ts`

- [ ] **Step 1: Read the current signature to confirm the exact shape**

Read `src/connectors/types.ts`. The current `toolFactory` is:
```typescript
toolFactory: (
  connectionId: string,
  apiKeys?: Record<string, string>,
) => Record<string, any>;
```

- [ ] **Step 2: Change the signature to require `providerConfigKey` as a third positional argument**

Replace the `toolFactory` field in the `ConnectorDefinition` interface with:

```typescript
  /**
   * Factory that produces tools given a connection identifier, any api-key
   * credentials, and the Nango provider_config_key used at call time.
   *
   * `providerConfigKey` is REQUIRED (not optional) so TypeScript rejects the
   * only place it matters — the call site in buildAllConnectorTools — if the
   * third argument is missing. For per-client Shopify apps the key varies
   * per workspace (e.g. "shopify-acme-7f3a2b"); a missing or silently-
   * defaulted key would route every tool call through the wrong Nango
   * integration and fail with a cryptic Shopify permission error.
   *
   * Non-Shopify connectors ignore this argument (they have one integration
   * key baked into their factory). Their arrow-function implementations in
   * the registry can still omit trailing parameters — TypeScript satisfies
   * the interface as long as the shape is assignable. What matters is that
   * the single call site in buildAllConnectorTools is checked.
   */
  toolFactory: (
    connectionId: string,
    apiKeys: Record<string, string> | undefined,
    providerConfigKey: string,
  ) => Record<string, any>;
```

Note the second argument is now `Record<string, string> | undefined` instead of optional — this keeps the positional order unambiguous at the call site without forcing non-Shopify registry entries to list three parameters in their arrow functions.

- [ ] **Step 3: Run the TypeScript compiler to see every call site that breaks**

Run: `npx tsc --noEmit`
Expected: errors in `src/connectors/registry.ts` and `src/connectors/build-toolset.ts` for every connector entry whose `toolFactory` doesn't match the new shape. Do NOT try to fix them yet — we want the error list as a worklist for Task 1.2.

- [ ] **Step 4: Do not commit yet**

Phase 1 commits after the call sites are updated. Leave the working tree dirty and move to Task 1.2.

### Task 1.2: Update every non-Shopify connector entry in the registry

**Files:**
- Modify: `src/connectors/registry.ts`

- [ ] **Step 1: Update every non-Shopify `toolFactory` arrow to accept (and ignore) the new parameter**

For each connector entry whose factory currently looks like `(connectionId) => ...` or `(_connId, apiKeys) => ...`, add the third argument. Even though the non-Shopify connectors don't use `providerConfigKey`, the signature must match the interface exactly.

For example, the Meta Ads entry changes from:
```typescript
    toolFactory: (connectionId) => createMetaAdsTools(connectionId),
```
to:
```typescript
    toolFactory: (connectionId, _apiKeys, _providerConfigKey) =>
      createMetaAdsTools(connectionId),
```

Apply the same pattern to: `meta-marketing-api`, `google-ads`, `google-analytics`, `google-sheets`. The Klaviyo and PostHog entries already take `(_connId, apiKeys) => ...`; extend them to `(_connId, apiKeys, _providerConfigKey) => ...`. The `apiKeys` parameter stays exactly where it was.

- [ ] **Step 2: Update the Shopify entry to pass the new parameter through**

Change the Shopify entry's factory from:
```typescript
    toolFactory: (connectionId) => createShopifyConnectorTools(connectionId),
```
to:
```typescript
    toolFactory: (connectionId, _apiKeys, providerConfigKey) =>
      createShopifyConnectorTools(connectionId, providerConfigKey),
```

This will cause a TypeScript error on the call to `createShopifyConnectorTools` because that function doesn't accept a second argument yet — we'll fix that in Task 1.3.

- [ ] **Step 3: Do not run the compiler yet**

`createShopifyConnectorTools` still has the old signature, so the compiler will still fail. Move on.

### Task 1.3: Thread `providerConfigKey` through the Shopify factory tree

**Files:**
- Modify: `src/connectors/tools/shopify/index.ts`
- Modify: `src/connectors/tools/shopify/products.ts`
- Modify: `src/connectors/tools/shopify/orders.ts`
- Modify: `src/connectors/tools/shopify/customers.ts`
- Modify: `src/connectors/tools/shopify/inventory.ts`
- Modify: `src/connectors/tools/shopify/collections.ts`
- Modify: `src/connectors/tools/shopify/discounts.ts`
- Modify: `src/connectors/tools/shopify/draft-orders.ts`
- Modify: `src/connectors/tools/shopify/misc.ts`

- [ ] **Step 1: Update `createShopifyConnectorTools` to accept and forward the key**

Replace the entire contents of `src/connectors/tools/shopify/index.ts` with:

```typescript
import { createShopifyProductTools } from "./products";
import { createShopifyOrderTools } from "./orders";
import { createShopifyCustomerTools } from "./customers";
import { createShopifyInventoryTools } from "./inventory";
import { createShopifyCollectionTools } from "./collections";
import { createShopifyDiscountTools } from "./discounts";
import { createShopifyDraftOrderTools } from "./draft-orders";
import { createShopifyMiscTools } from "./misc";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createShopifyConnectorTools(
  connectionId: string,
  providerConfigKey: string,
): Record<string, any> {
  return {
    ...createShopifyProductTools(connectionId, providerConfigKey),
    ...createShopifyOrderTools(connectionId, providerConfigKey),
    ...createShopifyCustomerTools(connectionId, providerConfigKey),
    ...createShopifyInventoryTools(connectionId, providerConfigKey),
    ...createShopifyCollectionTools(connectionId, providerConfigKey),
    ...createShopifyDiscountTools(connectionId, providerConfigKey),
    ...createShopifyDraftOrderTools(connectionId, providerConfigKey),
    ...createShopifyMiscTools(connectionId, providerConfigKey),
  };
}
```

- [ ] **Step 2: Update `createShopifyProductTools` signature**

In `src/connectors/tools/shopify/products.ts`, change the factory signature from:
```typescript
export function createShopifyProductTools(connectionId: string): Record<string, any> {
```
to:
```typescript
export function createShopifyProductTools(
  connectionId: string,
  providerConfigKey: string,
): Record<string, any> {
```

- [ ] **Step 3: Replace every `nangoProxy("shopify",` call in `products.ts` with `nangoProxy(providerConfigKey,`**

Search the file for the exact text `"shopify",` **on a line immediately after `nangoProxy(`**. The file has 16 `nangoProxy(` call sites and one unrelated use of the string `"shopify"` inside a Zod enum (`.enum(["shopify", "fulfillment_service"])` — do NOT touch this one).

Do the replacement manually for each `nangoProxy(` call. A line-level view should show each call as:
```typescript
          return await nangoProxy(
            "shopify",
            connectionId,
```
and must become:
```typescript
          return await nangoProxy(
            providerConfigKey,
            connectionId,
```

Verify the inventory tracking enum at line 331 area is untouched — the string `"shopify"` there is a Shopify API value, not a Nango integration key.

- [ ] **Step 4: Repeat Steps 2 and 3 for every other Shopify sub-file**

Apply the identical pattern (accept `providerConfigKey`, replace every `nangoProxy("shopify",` with `nangoProxy(providerConfigKey,`) to:
- `src/connectors/tools/shopify/orders.ts` (9 nangoProxy calls)
- `src/connectors/tools/shopify/customers.ts` (6 calls)
- `src/connectors/tools/shopify/inventory.ts` (6 calls)
- `src/connectors/tools/shopify/collections.ts` (8 calls)
- `src/connectors/tools/shopify/discounts.ts` (4 calls)
- `src/connectors/tools/shopify/draft-orders.ts` (6 calls)
- `src/connectors/tools/shopify/misc.ts` (7 calls)

For each file, do two things:
1. Change the function signature to add `providerConfigKey: string` as a second required parameter.
2. Replace every `nangoProxy(` call's first string argument from `"shopify"` to `providerConfigKey`.

- [ ] **Step 5: Run a full grep to confirm no Shopify tool file still passes `"shopify"` as the first arg to `nangoProxy`**

Run this command and expect **zero matches**:
```bash
grep -rn 'nangoProxy(\s*$' src/connectors/tools/shopify/ | while read -r line; do file=$(echo "$line" | cut -d: -f1); lineno=$(echo "$line" | cut -d: -f2); next=$((lineno + 1)); sed -n "${next}p" "$file" | grep -l '"shopify"'; done
```

Or simpler: run `grep -n '"shopify"' src/connectors/tools/shopify/*.ts` and manually verify that every remaining occurrence is **not** directly under a `nangoProxy(` call. The only legitimate remaining uses are in comments, in Zod enums (`["shopify", "fulfillment_service"]`), and possibly in description strings.

- [ ] **Step 6: Update `buildAllConnectorTools` to pass the key**

In `src/connectors/build-toolset.ts`, find the line:
```typescript
    const tools = connector.toolFactory(info.connectionId, info.apiKeys);
```
and replace it with:
```typescript
    const tools = connector.toolFactory(
      info.connectionId,
      info.apiKeys,
      info.providerConfigKey,
    );
```

- [ ] **Step 7: Run the TypeScript compiler and expect zero errors**

Run: `npx tsc --noEmit`
Expected: no errors. If there are still errors, inspect each one — it's almost always a missed Shopify sub-file signature, or a stray call site that skipped Step 3.

- [ ] **Step 8: Run the existing test suite**

Run: `npm test -- --run`
Expected: all existing tests still pass. We haven't changed runtime behavior — every Shopify tool call still hits Nango with the string `"shopify"` because the Shopify connector entry in the registry still has `providerConfigKey: "shopify"`. The signature refactor is mechanical; runtime is identical.

- [ ] **Step 9: Commit Phase 1**

```bash
git add src/connectors/types.ts src/connectors/registry.ts src/connectors/build-toolset.ts src/connectors/tools/shopify/
git commit -m "refactor: thread providerConfigKey through Shopify tool factory

Makes providerConfigKey a required positional argument on
ConnectorDefinition.toolFactory and every Shopify sub-factory so
that per-workspace Shopify apps can route through distinct Nango
integration keys. Non-Shopify connectors ignore the argument.

No runtime change — the Shopify entry still uses 'shopify' as its
providerConfigKey, so every call path continues hitting the same
integration. This lays the groundwork for Phase 2."
```

---

## Phase 2 — Registry pattern match and connection normalization

### Task 2.1: Add the slug regex and update `getConnectorByProviderKey`

**Files:**
- Modify: `src/connectors/registry.ts`
- Create: `src/connectors/__tests__/registry.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `src/connectors/__tests__/registry.test.ts` with:

```typescript
import { describe, it, expect } from "vitest";
import {
  getConnectorByProviderKey,
  SHOPIFY_PER_CLIENT_KEY_PATTERN,
} from "@/connectors/registry";

describe("SHOPIFY_PER_CLIENT_KEY_PATTERN", () => {
  it("matches canonical slug shapes", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme-7f3a2b")).toBe(true);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-a-000000")).toBe(true);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-longer-slug-name-abcdef")).toBe(true);
  });

  it("rejects short random suffix", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme-7f3a2")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-ACME-7f3a2b")).toBe(false);
  });

  it("rejects missing random suffix", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme")).toBe(false);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-")).toBe(false);
  });

  it("rejects the canonical key itself", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify")).toBe(false);
  });
});

describe("getConnectorByProviderKey", () => {
  it("direct-matches the canonical shopify key", () => {
    const c = getConnectorByProviderKey("shopify");
    expect(c?.id).toBe("shopify");
  });

  it("direct-matches non-shopify keys", () => {
    expect(getConnectorByProviderKey("meta-marketing-api")?.id).toBe("meta-marketing-api");
    expect(getConnectorByProviderKey("google-sheet")?.id).toBe("google-sheets");
  });

  it("resolves slug-shaped shopify keys to the canonical shopify connector", () => {
    const c = getConnectorByProviderKey("shopify-acme-7f3a2b");
    expect(c?.id).toBe("shopify");
  });

  it("does not resolve loose shopify-* keys", () => {
    expect(getConnectorByProviderKey("shopify-partner")).toBeUndefined();
    expect(getConnectorByProviderKey("shopify-legacy")).toBeUndefined();
  });

  it("returns undefined for unknown keys", () => {
    expect(getConnectorByProviderKey("nonsense")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- --run src/connectors/__tests__/registry.test.ts`
Expected: FAIL with `SHOPIFY_PER_CLIENT_KEY_PATTERN is not exported` and `getConnectorByProviderKey("shopify-acme-7f3a2b")` returning undefined.

- [ ] **Step 3: Implement the pattern and update the lookup function**

In `src/connectors/registry.ts`, find the existing `getConnectorByProviderKey` function at the bottom of the file and replace it with:

```typescript
/**
 * Strict pattern for per-client Shopify app keys generated by the admin endpoint.
 *
 *   shopify-{slug}-{6-char-random}
 *
 * slug = lowercase alphanumeric, length >= 1
 * rand = exactly 6 lowercase alphanumeric chars
 *
 * A loose `startsWith("shopify-")` check would incorrectly match any provider
 * key beginning with that prefix (e.g. a future `shopify-partner` integration
 * or a typo'd key). Locking the shape to the admin endpoint's slug format
 * keeps the routing deterministic and auditable.
 */
export const SHOPIFY_PER_CLIENT_KEY_PATTERN = /^shopify-[a-z0-9]+-[a-z0-9]{6}$/;

export function getConnectorByProviderKey(
  key: string,
): ConnectorDefinition | undefined {
  // Direct exact match wins for everything, including the canonical "shopify"
  const direct = CONNECTORS.find((c) => c.providerConfigKey === key && c.enabled);
  if (direct) return direct;
  // Shopify multi-app: only slug-shaped keys resolve to the canonical Shopify connector
  if (SHOPIFY_PER_CLIENT_KEY_PATTERN.test(key)) {
    return CONNECTORS.find((c) => c.id === "shopify" && c.enabled);
  }
  return undefined;
}
```

Leave `getConnectorById` and `getEnabledConnectors` unchanged.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run src/connectors/__tests__/registry.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/registry.ts src/connectors/__tests__/registry.test.ts
git commit -m "feat(connectors): recognize slug-shaped shopify-* keys in registry

Adds SHOPIFY_PER_CLIENT_KEY_PATTERN and falls back to it in
getConnectorByProviderKey so that per-client Shopify integration
keys (e.g. shopify-acme-7f3a2b) resolve to the canonical Shopify
connector. Strict pattern prevents false positives on arbitrary
shopify-* keys."
```

### Task 2.2: Normalize the `Connections` map key in `getUserConnections`

**Files:**
- Modify: `src/connectors/nango/connections.ts`

The goal: when Nango returns a connection with `provider_config_key = "shopify-acme-7f3a2b"`, the `Connections` map should store it under the canonical key `"shopify"` so that every downstream consumer (system prompt, `buildAllConnectorTools`, `disconnectHandler`) finds it by the stable id. The actual Nango key stays inside `ConnectionInfo.providerConfigKey`.

- [ ] **Step 1: Locate the two places where the map is populated**

In `src/connectors/nango/connections.ts`, there are two spots that assign into `connections[...]`:

1. Inside the OAuth-branch loop (`connections[conn.provider_config_key] = { ... }`)
2. Inside the api-key merge loop (`connections[entry.providerConfigKey] = { ... }`)

We need to derive the map key via the registry for both.

- [ ] **Step 2: Update the OAuth branch**

Find this block:
```typescript
      } else {
        // OAuth connectors — no getConnection call needed
        connections[conn.provider_config_key] = {
          providerConfigKey: conn.provider_config_key,
          connectionId: conn.connection_id,
        };
      }
```

Replace with:
```typescript
      } else {
        // OAuth connectors — no getConnection call needed
        // Normalize map key to canonical connector id so downstream consumers
        // find per-client Shopify apps under connections["shopify"]
        const mapKey = connector?.id ?? conn.provider_config_key;
        connections[mapKey] = {
          providerConfigKey: conn.provider_config_key,
          connectionId: conn.connection_id,
        };
      }
```

Note: `connector` is already bound two lines above the original block (`const connector = getConnectorByProviderKey(conn.provider_config_key);`) — so `connector?.id` is in scope.

- [ ] **Step 3: Update the api-key branch**

Find the loop:
```typescript
    // Merge successful api-key results into the connections map
    for (const entry of apiKeyResults) {
      if (!entry) continue;
      connections[entry.providerConfigKey] = {
        providerConfigKey: entry.providerConfigKey,
        connectionId: entry.connectionId,
        apiKeys: entry.apiKeys,
      };
    }
```

Replace with:
```typescript
    // Merge successful api-key results into the connections map
    for (const entry of apiKeyResults) {
      if (!entry) continue;
      const connector = getConnectorByProviderKey(entry.providerConfigKey);
      const mapKey = connector?.id ?? entry.providerConfigKey;
      connections[mapKey] = {
        providerConfigKey: entry.providerConfigKey,
        connectionId: entry.connectionId,
        apiKeys: entry.apiKeys,
      };
    }
```

- [ ] **Step 4: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Audit every `getUserConnections` consumer**

Run: `grep -rn "getUserConnections" src/ --include="*.ts"`
Expected call sites (as of this plan's baseline):

1. `src/routes/chat.ts` — reads the returned map to build the connector prompt block. Only iterates entries; accesses `.providerConfigKey` and `.connectionId` on each value. **Safe** — no map-key dependency.
2. `src/routes/connectors.ts::disconnectHandler` — iterates `Object.values(wsConnections)` and compares `conn.providerConfigKey === providerConfigKey`. Reads from the nested `ConnectionInfo`, not the map key. **Safe.**
3. `src/connectors/build-toolset.ts::buildAllConnectorTools` — iterates `Object.entries(connections)` and passes `info.providerConfigKey` into the tool factory (after Phase 1's change). **Safe.**
4. `src/connectors/build-toolset.ts::getOrCreateConnectorProcessor` — uses `Object.keys(connections)` to hash connection identity for cache keys. **Map-key-sensitive**: after normalization, the hash changes shape. That's fine because the hash is scoped to the cached processor — as long as the input is consistent, the hash stays stable. Note this in the commit message.

For each hit in the grep output, inspect the file and confirm one of:
- It reads `.providerConfigKey` / `.connectionId` / `.apiKeys` from the nested value (safe)
- It iterates keys only for cache-identity purposes (safe — hash stays consistent)
- It compares the map key against a hardcoded string like `"shopify"` — this is actually the *desired* pattern post-normalization

If you find a consumer that compares the map key against a raw Nango key (e.g. `connections["shopify-acme-7f3a2b"]`), flag it as a bug — the map no longer contains that key as a top-level entry.

- [ ] **Step 6: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass. No existing tests cover `getUserConnections` directly — this change is exercised downstream via the registry tests and by integration tests in later phases.

- [ ] **Step 7: Commit**

```bash
git add src/connectors/nango/connections.ts
git commit -m "refactor(connectors): normalize Connections map key to canonical id

getUserConnections now stores each connection under its canonical
connector id (e.g. \"shopify\" for any shopify-* key) so that
downstream code can look up connections by stable id while still
passing the dynamic provider_config_key to Nango via
ConnectionInfo.providerConfigKey.

Audited consumers: routes/chat.ts, routes/connectors.ts
(disconnectHandler), connectors/build-toolset.ts
(buildAllConnectorTools, getOrCreateConnectorProcessor). All
read from ConnectionInfo or iterate keys opaquely — no consumer
compares map keys against raw Nango provider config keys."
```

---

## Phase 3 — Database layer

### Task 3.1: Define the Drizzle schema

**Files:**
- Create: `src/db/schema/shopify-apps.ts`
- Modify: `src/db/schema/index.ts`

- [ ] **Step 1: Create the schema file**

Write `src/db/schema/shopify-apps.ts`:

```typescript
import {
  check,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * shopify_apps — per-workspace Shopify custom-app registry.
 *
 * One row per workspace at a time (enforced by the partial unique index).
 * Credentials live in Nango, not here — this table only maps a workspace
 * to the Nango provider_config_key that holds its client_id/client_secret.
 *
 * See docs/superpowers/specs/2026-04-06-shopify-multi-app-registry-design.md
 */
export const shopifyApps = pgTable(
  "shopify_apps",
  {
    /** Clerk org id. Primary key. */
    workspaceId: text("workspace_id").primaryKey(),
    /** Nango provider_config_key, e.g. "shopify-acme-7f3a2b". Globally unique. */
    providerConfigKey: text("provider_config_key").notNull().unique(),
    /** Human-readable label, e.g. "ACME Shopify App". */
    appName: text("app_name").notNull(),
    /** Last 4 chars of the OAuth client_id (for support identification). */
    clientIdLast4: text("client_id_last4"),
    /** Forward-compat metadata; nullable in V1. */
    storeDomain: text("store_domain"),
    /** Shopify OAuth scopes the app was created with. */
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    /** Lifecycle state for the two-phase commit against Nango. */
    status: text("status").notNull().default("active"),
    /** Soft-delete marker. NULL = active slot. */
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** Admin user / operator identifier (e.g. Clerk user id or CLI username). */
    createdBy: text("created_by").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // Only one active (not-disabled) row per workspace. Soft-deleted rows
    // accumulate as audit trail. Pending/failed/deleting rows also occupy
    // this slot so a second provisioning attempt cannot race a stuck first.
    uniqueIndex("shopify_apps_workspace_active_idx")
      .on(table.workspaceId)
      .where(sql`disabled_at IS NULL`),
    check(
      "shopify_apps_status_check",
      sql`status IN ('pending', 'active', 'failed', 'deleting')`,
    ),
  ],
);

export type ShopifyApp = typeof shopifyApps.$inferSelect;
export type NewShopifyApp = typeof shopifyApps.$inferInsert;

/** Runtime-visible statuses for connect-session lookups. */
export type ShopifyAppStatus = "pending" | "active" | "failed" | "deleting";
```

- [ ] **Step 2: Re-export from the schema index**

Edit `src/db/schema/index.ts` and add the new export. The file currently looks like:
```typescript
export * from "./chats";
export * from "./messages";
export * from "./sharedChats";
export * from "./userAttachments";
export * from "./user-connections";
export * from "./agent-jobs";
export * from "./agent-job-runs";
export * from "./agent-job-insights";
export * from "./agent-job-chats";
export * from "./relations";
```

Add one line before `./relations`:
```typescript
export * from "./shopify-apps";
```

- [ ] **Step 3: Run `drizzle-kit generate` to produce the migration SQL**

Run: `npm run db:generate`
Expected: a new file `drizzle/0006_<some-name>.sql` appears along with an updated `drizzle/meta/0006_snapshot.json` and `drizzle/meta/_journal.json`. The filename's random suffix is generated by drizzle-kit — do not try to control it.

- [ ] **Step 4: Inspect the generated SQL**

Read the newly created `drizzle/0006_*.sql`. Verify it contains each of the following — drizzle-kit sometimes inlines constraints in the `CREATE TABLE` statement and sometimes emits them as separate `ALTER TABLE` statements, so accept either form:

1. **`CREATE TABLE "shopify_apps"`** — present exactly once.
2. **All 10 columns**: `workspace_id`, `provider_config_key`, `app_name`, `client_id_last4`, `store_domain`, `scopes`, `status`, `disabled_at`, `created_at`, `created_by`, `updated_at`. (`workspace_id`, `provider_config_key`, `app_name`, `scopes`, `status`, `created_at`, `created_by`, `updated_at` must be `NOT NULL`.)
3. **Primary key on `workspace_id`** — either `"workspace_id" text PRIMARY KEY` inline or a separate `ALTER TABLE ... ADD PRIMARY KEY`.
4. **Unique constraint on `provider_config_key`** — either `"provider_config_key" text NOT NULL UNIQUE` inline or `ALTER TABLE "shopify_apps" ADD CONSTRAINT ... UNIQUE ("provider_config_key")`.
5. **Check constraint on `status`** — either inline `CHECK (status IN ('pending', 'active', 'failed', 'deleting'))` or a separate `ALTER TABLE ... ADD CONSTRAINT "shopify_apps_status_check"`.
6. **Partial unique index**: a `CREATE UNIQUE INDEX ... ON "shopify_apps" ("workspace_id") WHERE disabled_at IS NULL;` statement. The index name should be `shopify_apps_workspace_active_idx`. The exact column list format (`"workspace_id"` vs `USING btree ("workspace_id")`) may vary by drizzle-kit version — don't assert on `USING btree`.

If any of these are missing, the schema file is wrong — fix it and re-run `db:generate` (delete the bad migration file first to avoid stale artifacts).

If all of these are present but in a shape that looks unusual compared to this list (inline vs ALTER TABLE differences), that's drizzle-kit being drizzle-kit — move on.

- [ ] **Step 5: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit the schema and migration**

```bash
git add src/db/schema/shopify-apps.ts src/db/schema/index.ts drizzle/0006_*.sql drizzle/meta/0006_snapshot.json drizzle/meta/_journal.json
git commit -m "feat(db): add shopify_apps table for per-workspace app registry

Creates the shopify_apps Drizzle schema and migration. Each row
maps a Clerk workspace to the Nango provider_config_key holding
that workspace's custom Shopify app credentials. The partial
unique index on (workspace_id) WHERE disabled_at IS NULL lets
soft-deleted rows accumulate as audit history while guaranteeing
at most one active slot per workspace."
```

### Task 3.2: Query helpers

**Files:**
- Create: `src/db/queries/shopify-apps.ts`
- Create: `src/db/queries/__tests__/shopify-apps.test.ts`

- [ ] **Step 1: Write the failing tests for the query helpers**

Create `src/db/queries/__tests__/shopify-apps.test.ts`:

```typescript
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the db client before the module under test is imported
vi.mock("@/db/client", () => {
  const insert = vi.fn();
  const update = vi.fn();
  const select = vi.fn();
  return {
    db: { insert, update, select },
  };
});

import { db } from "@/db/client";
import {
  getActiveShopifyApp,
  insertPendingShopifyApp,
  promoteShopifyAppToActive,
  markShopifyAppFailed,
  markShopifyAppDeleting,
  finalizeShopifyAppSoftDelete,
} from "@/db/queries/shopify-apps";

describe("shopify-apps queries", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("getActiveShopifyApp filters to status=active and disabled_at IS NULL", async () => {
    const limit = vi.fn().mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "active",
        disabledAt: null,
      },
    ]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as any).mockReturnValue({ from });

    const result = await getActiveShopifyApp("ws1");
    expect(result?.providerConfigKey).toBe("shopify-acme-abc123");
    expect(db.select).toHaveBeenCalled();
  });

  it("getActiveShopifyApp returns null when no row found", async () => {
    const limit = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ where });
    (db.select as any).mockReturnValue({ from });

    const result = await getActiveShopifyApp("ws-empty");
    expect(result).toBeNull();
  });

  it("insertPendingShopifyApp inserts with status='pending'", async () => {
    const values = vi.fn().mockResolvedValue(undefined);
    (db.insert as any).mockReturnValue({ values });

    await insertPendingShopifyApp({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      appName: "ACME",
      clientIdLast4: "cafe",
      storeDomain: "acme.myshopify.com",
      scopes: ["read_products"],
      createdBy: "op@marketmint",
    });

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "pending",
      }),
    );
  });

  it("promoteShopifyAppToActive only updates rows currently in pending", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    (db.update as any).mockReturnValue({ set });

    await promoteShopifyAppToActive("ws1");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "active" }),
    );
  });

  it("markShopifyAppFailed updates status to failed", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    (db.update as any).mockReturnValue({ set });

    await markShopifyAppFailed("ws1");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ status: "failed" }),
    );
  });

  it("markShopifyAppDeleting returns the provider key when row flipped", async () => {
    const returning = vi.fn().mockResolvedValue([
      { providerConfigKey: "shopify-acme-abc123" },
    ]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as any).mockReturnValue({ set });

    const result = await markShopifyAppDeleting("ws1");
    expect(result).toBe("shopify-acme-abc123");
  });

  it("markShopifyAppDeleting returns null when no active row exists", async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const where = vi.fn().mockReturnValue({ returning });
    const set = vi.fn().mockReturnValue({ where });
    (db.update as any).mockReturnValue({ set });

    const result = await markShopifyAppDeleting("ws1");
    expect(result).toBeNull();
  });

  it("finalizeShopifyAppSoftDelete sets disabled_at", async () => {
    const where = vi.fn().mockResolvedValue(undefined);
    const set = vi.fn().mockReturnValue({ where });
    (db.update as any).mockReturnValue({ set });

    await finalizeShopifyAppSoftDelete("ws1");
    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({ disabledAt: expect.any(Date) }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- --run src/db/queries/__tests__/shopify-apps.test.ts`
Expected: FAIL because `src/db/queries/shopify-apps.ts` doesn't exist.

- [ ] **Step 3: Implement the query helpers**

Create `src/db/queries/shopify-apps.ts`:

```typescript
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  shopifyApps,
  type ShopifyApp,
  type ShopifyAppStatus,
} from "@/db/schema/shopify-apps";

export interface InsertPendingShopifyAppParams {
  workspaceId: string;
  providerConfigKey: string;
  appName: string;
  clientIdLast4: string | null;
  storeDomain: string | null;
  scopes: string[];
  createdBy: string;
}

/**
 * Fetch the workspace's currently-active Shopify app row.
 * Filters to status='active' AND disabled_at IS NULL.
 *
 * Pending/failed/deleting rows are invisible to the runtime — the connect
 * session handler must not resolve them.
 */
export async function getActiveShopifyApp(
  workspaceId: string,
): Promise<ShopifyApp | null> {
  const rows = await db
    .select()
    .from(shopifyApps)
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
        eq(shopifyApps.status, "active"),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Fetch any row (active OR pending OR failed OR deleting) that occupies
 * the workspace's partial-unique-index slot. Used by the admin POST
 * handler to detect slot collisions before inserting.
 */
export async function getAnyActiveOrPendingShopifyApp(
  workspaceId: string,
): Promise<ShopifyApp | null> {
  const rows = await db
    .select()
    .from(shopifyApps)
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Insert a new row in `pending` state. Caller must check for an existing
 * slot first via getAnyActiveOrPendingShopifyApp — this function does NOT
 * handle the unique-index violation gracefully; Postgres will throw.
 */
export async function insertPendingShopifyApp(
  params: InsertPendingShopifyAppParams,
): Promise<void> {
  await db.insert(shopifyApps).values({
    workspaceId: params.workspaceId,
    providerConfigKey: params.providerConfigKey,
    appName: params.appName,
    clientIdLast4: params.clientIdLast4,
    storeDomain: params.storeDomain,
    scopes: params.scopes,
    status: "pending",
    createdBy: params.createdBy,
  });
}

/**
 * Promote a pending row to active. Only affects rows currently in
 * status='pending' for the workspace (other statuses are a no-op).
 */
export async function promoteShopifyAppToActive(
  workspaceId: string,
): Promise<void> {
  await db
    .update(shopifyApps)
    .set({ status: "active", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "pending"),
      ),
    );
}

/**
 * Mark a pending row as failed (Nango integration creation failed or
 * reconcile could not find the integration).
 */
export async function markShopifyAppFailed(
  workspaceId: string,
): Promise<void> {
  await db
    .update(shopifyApps)
    .set({ status: "failed", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "pending"),
      ),
    );
}

/**
 * Flip the active row to `deleting` and return its provider_config_key.
 * Returns null if no active row was found (concurrent delete, no row, or
 * row is already in a non-active state). Callers use this as the gate
 * for starting the teardown sequence.
 */
export async function markShopifyAppDeleting(
  workspaceId: string,
): Promise<string | null> {
  const rows = await db
    .update(shopifyApps)
    .set({ status: "deleting", updatedAt: new Date() })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        isNull(shopifyApps.disabledAt),
        eq(shopifyApps.status, "active"),
      ),
    )
    .returning({ providerConfigKey: shopifyApps.providerConfigKey });
  return rows[0]?.providerConfigKey ?? null;
}

/**
 * Finalize the soft-delete by setting disabled_at. Called after Nango
 * teardown has completed.
 */
export async function finalizeShopifyAppSoftDelete(
  workspaceId: string,
): Promise<void> {
  const now = new Date();
  await db
    .update(shopifyApps)
    .set({ disabledAt: now, updatedAt: now })
    .where(
      and(
        eq(shopifyApps.workspaceId, workspaceId),
        eq(shopifyApps.status, "deleting"),
      ),
    );
}

/**
 * List rows in a non-terminal state that have been stuck for more than
 * `olderThanMs`. Used by the reconcile job to detect crashes between
 * Nango create and DB promote (pending) or incomplete teardown (deleting).
 */
export async function listStuckShopifyApps(
  olderThanMs: number,
): Promise<ShopifyApp[]> {
  const cutoff = new Date(Date.now() - olderThanMs);
  return db
    .select()
    .from(shopifyApps)
    .where(
      and(
        isNull(shopifyApps.disabledAt),
        or(
          eq(shopifyApps.status, "pending"),
          eq(shopifyApps.status, "deleting"),
        ),
        lte(shopifyApps.updatedAt, cutoff),
      ),
    );
}

/** Narrow helper — used by the admin POST handler to distinguish slot states. */
export function isSlotBlocking(status: ShopifyAppStatus): boolean {
  return status === "pending" || status === "active";
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run src/db/queries/__tests__/shopify-apps.test.ts`
Expected: all 8 tests pass. If any fail, inspect the mock chain — Drizzle's fluent builder pattern (`db.select().from().where().limit()`) must be mocked level-by-level.

- [ ] **Step 5: Run the TypeScript compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/db/queries/shopify-apps.ts src/db/queries/__tests__/shopify-apps.test.ts
git commit -m "feat(db): add shopify-apps query helpers

Implements all reads and writes against the shopify_apps table
including the two-phase commit helpers (insertPending, promote,
markFailed, markDeleting, finalizeSoftDelete) and the reconcile
helper listStuckShopifyApps."
```

---

## Phase 4 — Admin POST endpoint

### Task 4.1: `ADMIN_API_TOKEN` env var + admin middleware

**Files:**
- Modify: `src/env.ts`
- Create: `src/middleware/admin-auth.ts`

- [ ] **Step 1: Add `ADMIN_API_TOKEN` to the env schema**

In `src/env.ts`, inside the `envSchema = z.object({...})` block, add after the existing Nango lines (around line 58):

```typescript
  // Admin / operator auth
  ADMIN_API_TOKEN: z
    .string()
    .min(32, "ADMIN_API_TOKEN must be at least 32 chars of high-entropy random data")
    .optional(),
```

It is optional so dev/test environments without the token still boot. Runtime checks in the middleware will return 503 when the token is unset.

- [ ] **Step 2: Run the env loader to confirm nothing breaks**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Write the admin middleware**

Create `src/middleware/admin-auth.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import { env } from "@/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("admin-auth");

/**
 * Simple token-bucket-ish rate limit per IP for the admin endpoints.
 * In-memory only — good enough for a single-operator ops tool.
 * Resets every minute; allows 10 requests per IP per window.
 */
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 10;
const rateLimitCounts = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitCounts.get(ip);
  if (!entry || entry.resetAt <= now) {
    rateLimitCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count += 1;
  return true;
}

function getClientIp(c: Parameters<MiddlewareHandler>[0]): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/**
 * Admin endpoint gate. Validates:
 *   - ADMIN_API_TOKEN is configured at runtime
 *   - Authorization: Bearer ${ADMIN_API_TOKEN} is present and matches
 *   - Per-IP rate limit has not been exceeded
 *
 * Writes a structured audit log entry for every call (success or failure)
 * via the existing pino logger pipeline.
 */
export const adminAuthMiddleware: MiddlewareHandler = async (c, next) => {
  const ip = getClientIp(c);
  const path = c.req.path;
  const method = c.req.method;

  if (!env.ADMIN_API_TOKEN) {
    log.warn({ ip, path, method }, "admin endpoint called but ADMIN_API_TOKEN is unset");
    return c.json({ error: "Admin endpoint not configured" }, 503);
  }

  if (!checkRateLimit(ip)) {
    log.warn({ ip, path, method }, "admin rate limit exceeded");
    return c.json({ error: "Rate limit exceeded" }, 429);
  }

  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match || match[1] !== env.ADMIN_API_TOKEN) {
    log.warn({ ip, path, method }, "admin auth failed");
    return c.json({ error: "Unauthorized" }, 401);
  }

  const adminUser = c.req.header("x-admin-user") ?? "unknown";
  c.set("adminUser", adminUser);

  log.info({ ip, path, method, adminUser }, "admin request authorized");
  await next();
};
```

- [ ] **Step 4: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/env.ts src/middleware/admin-auth.ts
git commit -m "feat(admin): add ADMIN_API_TOKEN env var and admin auth middleware

Introduces a service-token gate for admin-only endpoints. Validates
Authorization: Bearer header against ADMIN_API_TOKEN, rate limits
to 10 req/min per IP, and writes structured audit log entries."
```

### Task 4.2: Zod schemas for admin endpoints

**Files:**
- Create: `src/schemas/admin-shopify-apps.ts`

- [ ] **Step 1: Create the schemas**

Write `src/schemas/admin-shopify-apps.ts`:

```typescript
import { z } from "zod";

/**
 * POST /api/cowork/admin/shopify-apps — request body.
 *
 * Validation rules:
 *   - workspace_id must look like a Clerk org id (non-empty string)
 *   - app_name is free-form but must produce a valid slug after normalization
 *   - client_id / client_secret are forwarded to Nango and never persisted here
 *   - scopes must be a non-empty array of Shopify scope strings
 *   - store_domain is optional forward-compat metadata
 */
export const CreateShopifyAppBodySchema = z.object({
  workspace_id: z.string().min(1, "workspace_id is required"),
  app_name: z
    .string()
    .min(1, "app_name is required")
    .max(120, "app_name must be 120 chars or fewer"),
  client_id: z.string().min(1, "client_id is required"),
  client_secret: z.string().min(1, "client_secret is required"),
  scopes: z
    .array(z.string().min(1))
    .min(1, "scopes must include at least one scope"),
  store_domain: z
    .string()
    .regex(/\.myshopify\.com$/i, "store_domain must end with .myshopify.com")
    .optional(),
});

export type CreateShopifyAppBody = z.infer<typeof CreateShopifyAppBodySchema>;

/**
 * DELETE /api/cowork/admin/shopify-apps/:workspace_id — path param.
 */
export const DeleteShopifyAppParamSchema = z.object({
  workspace_id: z.string().min(1, "workspace_id is required"),
});
```

- [ ] **Step 2: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/schemas/admin-shopify-apps.ts
git commit -m "feat(admin): add zod schemas for shopify-apps admin endpoints"
```

### Task 4.3: Slug helper

**Files:**
- Modify: `src/routes/admin/shopify-apps.ts` (will be created in Task 4.4 — for now, create a helper function alongside).
- Create: `src/connectors/shopify-slug.ts`

- [ ] **Step 1: Write the slug generator tests**

Create `src/connectors/__tests__/shopify-slug.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { generateShopifyProviderConfigKey } from "@/connectors/shopify-slug";
import { SHOPIFY_PER_CLIENT_KEY_PATTERN } from "@/connectors/registry";

describe("generateShopifyProviderConfigKey", () => {
  it("produces a key matching SHOPIFY_PER_CLIENT_KEY_PATTERN", () => {
    const key = generateShopifyProviderConfigKey("ACME Shopify App");
    expect(key).toMatch(SHOPIFY_PER_CLIENT_KEY_PATTERN);
  });

  it("lowercases and strips non-alphanumeric from the slug portion", () => {
    const key = generateShopifyProviderConfigKey("ACME Corp! (v2)");
    expect(key.startsWith("shopify-acmecorpv2-")).toBe(true);
  });

  it("handles names that collapse to empty slug by using 'app' fallback", () => {
    const key = generateShopifyProviderConfigKey("!!!");
    expect(key.startsWith("shopify-app-")).toBe(true);
    expect(key).toMatch(SHOPIFY_PER_CLIENT_KEY_PATTERN);
  });

  it("produces unique random suffixes across calls", () => {
    const keys = new Set(
      Array.from({ length: 20 }, () => generateShopifyProviderConfigKey("acme")),
    );
    expect(keys.size).toBe(20);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- --run src/connectors/__tests__/shopify-slug.test.ts`
Expected: FAIL with import error (`shopify-slug.ts` doesn't exist).

- [ ] **Step 3: Implement the slug generator**

Create `src/connectors/shopify-slug.ts`:

```typescript
import { randomBytes } from "node:crypto";

/**
 * Generate a Nango provider_config_key for a new per-client Shopify app.
 *
 * Format: shopify-{slug}-{6-char-random}
 *   - slug: lowercase alphanumeric derived from app name (non-alphanumeric stripped)
 *   - random: 6 chars of lowercase hex from crypto.randomBytes
 *
 * The shape is validated by SHOPIFY_PER_CLIENT_KEY_PATTERN in the registry.
 * An empty slug (name collapsed to nothing) falls back to "app".
 */
export function generateShopifyProviderConfigKey(appName: string): string {
  const slug = appName.toLowerCase().replace(/[^a-z0-9]/g, "");
  const safeSlug = slug.length > 0 ? slug : "app";
  const rand = randomBytes(3).toString("hex"); // 3 bytes = 6 hex chars
  return `shopify-${safeSlug}-${rand}`;
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run src/connectors/__tests__/shopify-slug.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/connectors/shopify-slug.ts src/connectors/__tests__/shopify-slug.test.ts
git commit -m "feat(connectors): add shopify provider_config_key slug generator"
```

### Task 4.4: POST handler — DB-first two-phase commit

**Files:**
- Create: `src/routes/admin/shopify-apps.ts`
- Create: `src/routes/admin/__tests__/shopify-apps.test.ts`

- [ ] **Step 1: Write the failing integration tests for the POST handler**

Create `src/routes/admin/__tests__/shopify-apps.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the Nango client module
vi.mock("@/connectors/nango/client", () => ({
  getNango: vi.fn(),
}));

// Mock the query helpers
vi.mock("@/db/queries/shopify-apps", () => ({
  getActiveShopifyApp: vi.fn(),
  getAnyActiveOrPendingShopifyApp: vi.fn(),
  insertPendingShopifyApp: vi.fn(),
  promoteShopifyAppToActive: vi.fn(),
  markShopifyAppFailed: vi.fn(),
  markShopifyAppDeleting: vi.fn(),
  finalizeShopifyAppSoftDelete: vi.fn(),
}));

// Mock the cache-invalidation modules — DELETE handler calls these and we
// don't want the real implementations mutating in-memory caches across tests.
// These mocks MUST be set up in Phase 4 (not deferred to Phase 5) because
// vitest hoists vi.mock calls to the top of the file regardless; declaring
// them alongside the POST tests prevents a half-mocked module state.
vi.mock("@/connectors/nango/connections", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, invalidateConnectionsCache: vi.fn() };
});
vi.mock("@/connectors/build-toolset", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, invalidateProcessorCache: vi.fn() };
});

import type { Context } from "hono";
import { getNango } from "@/connectors/nango/client";
import {
  getAnyActiveOrPendingShopifyApp,
  insertPendingShopifyApp,
  promoteShopifyAppToActive,
  markShopifyAppFailed,
} from "@/db/queries/shopify-apps";
import { createShopifyAppHandler } from "@/routes/admin/shopify-apps";

/**
 * Build a minimal Hono-shaped mock context. The `get` mock is key-aware:
 * `c.get("adminUser")` returns the configured admin user; everything else
 * returns undefined. A blanket `mockReturnValue("op@marketmint")` would make
 * `c.get("authUser")` also return the string "op@marketmint" which would crash
 * handlers that treat it as an auth user object.
 */
function makeCtx(
  body: unknown,
  opts: { adminUser?: string; headers?: Record<string, string> } = {},
): Context {
  const adminUser = opts.adminUser ?? "op@marketmint";
  const headers = opts.headers ?? {};
  return {
    req: {
      json: vi.fn().mockResolvedValue(body),
      path: "/api/cowork/admin/shopify-apps",
      method: "POST",
      header: vi.fn((name: string) => headers[name.toLowerCase()]),
    },
    get: vi.fn((key: string) => (key === "adminUser" ? adminUser : undefined)),
    json: vi.fn((payload, status) => ({ payload, status })),
  } as unknown as Context;
}

describe("POST /admin/shopify-apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 on invalid body", async () => {
    const c = makeCtx({ workspace_id: "" });
    const res: any = await createShopifyAppHandler(c);
    expect(res.status).toBe(400);
  });

  it("returns 503 when Nango is not configured", async () => {
    (getNango as any).mockReturnValue(null);
    const c = makeCtx({
      workspace_id: "ws1",
      app_name: "ACME",
      client_id: "abcdef1234",
      client_secret: "secret",
      scopes: ["read_products"],
    });
    const res: any = await createShopifyAppHandler(c);
    expect(res.status).toBe(503);
  });

  it("returns 409 when workspace already has an active or pending row (pre-check)", async () => {
    (getNango as any).mockReturnValue({ createIntegration: vi.fn() });
    (getAnyActiveOrPendingShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      status: "active",
    });
    const c = makeCtx({
      workspace_id: "ws1",
      app_name: "ACME",
      client_id: "abcdef1234",
      client_secret: "secret",
      scopes: ["read_products"],
    });
    const res: any = await createShopifyAppHandler(c);
    expect(res.status).toBe(409);
    expect(insertPendingShopifyApp).not.toHaveBeenCalled();
  });

  it("returns 409 when insertPendingShopifyApp throws 23505 (TOCTOU race)", async () => {
    (getNango as any).mockReturnValue({ createIntegration: vi.fn() });
    (getAnyActiveOrPendingShopifyApp as any).mockResolvedValue(null);
    // Simulate Postgres unique-constraint violation on the insert.
    const pgError = Object.assign(new Error("duplicate key"), { code: "23505" });
    (insertPendingShopifyApp as any).mockRejectedValue(pgError);

    const c = makeCtx({
      workspace_id: "ws1",
      app_name: "ACME",
      client_id: "abcdef1234",
      client_secret: "secret",
      scopes: ["read_products"],
    });
    const res: any = await createShopifyAppHandler(c);

    expect(res.status).toBe(409);
    // The Nango integration must NOT be created when the slot race fires.
    const nangoMock = (getNango as any).mock.results[0]?.value;
    expect(nangoMock.createIntegration).not.toHaveBeenCalled();
  });

  it("happy path: insert pending, call Nango, promote to active", async () => {
    const createIntegration = vi.fn().mockResolvedValue({ data: { unique_key: "ok" } });
    (getNango as any).mockReturnValue({ createIntegration });
    (getAnyActiveOrPendingShopifyApp as any).mockResolvedValue(null);
    (insertPendingShopifyApp as any).mockResolvedValue(undefined);
    (promoteShopifyAppToActive as any).mockResolvedValue(undefined);

    const c = makeCtx({
      workspace_id: "ws1",
      app_name: "ACME Shopify App",
      client_id: "client_abcdef1234",
      client_secret: "shpss_supersecret",
      scopes: ["read_products", "write_products"],
      store_domain: "acme.myshopify.com",
    });
    const res: any = await createShopifyAppHandler(c);

    expect(insertPendingShopifyApp).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: "ws1",
        appName: "ACME Shopify App",
        clientIdLast4: "1234",
        storeDomain: "acme.myshopify.com",
      }),
    );
    expect(createIntegration).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "shopify",
        unique_key: expect.stringMatching(/^shopify-acmeshopifyapp-[a-z0-9]{6}$/),
        credentials: expect.objectContaining({
          type: "OAUTH2",
          client_id: "client_abcdef1234",
          client_secret: "shpss_supersecret",
          scopes: "read_products,write_products",
        }),
      }),
    );
    expect(promoteShopifyAppToActive).toHaveBeenCalledWith("ws1");
    expect(res.status).toBe(200);
    expect(res.payload).toEqual(
      expect.objectContaining({
        status: "active",
        provider_config_key: expect.stringMatching(/^shopify-acmeshopifyapp-[a-z0-9]{6}$/),
      }),
    );
  });

  it("on Nango failure: marks row as failed and returns 502", async () => {
    const createIntegration = vi
      .fn()
      .mockRejectedValue(new Error("Nango down"));
    (getNango as any).mockReturnValue({ createIntegration });
    (getAnyActiveOrPendingShopifyApp as any).mockResolvedValue(null);
    (insertPendingShopifyApp as any).mockResolvedValue(undefined);

    const c = makeCtx({
      workspace_id: "ws1",
      app_name: "ACME",
      client_id: "abcdef1234",
      client_secret: "secret",
      scopes: ["read_products"],
    });
    const res: any = await createShopifyAppHandler(c);

    expect(markShopifyAppFailed).toHaveBeenCalledWith("ws1");
    expect(res.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- --run src/routes/admin/__tests__/shopify-apps.test.ts`
Expected: FAIL — `createShopifyAppHandler` doesn't exist yet.

- [ ] **Step 3: Implement the POST handler**

Create `src/routes/admin/shopify-apps.ts`:

```typescript
import type { Context } from "hono";
import { getNango } from "@/connectors/nango/client";
import {
  getAnyActiveOrPendingShopifyApp,
  insertPendingShopifyApp,
  promoteShopifyAppToActive,
  markShopifyAppFailed,
  markShopifyAppDeleting,
  finalizeShopifyAppSoftDelete,
  getActiveShopifyApp,
} from "@/db/queries/shopify-apps";
import {
  invalidateConnectionsCache,
} from "@/connectors/nango/connections";
import { invalidateProcessorCache } from "@/connectors/build-toolset";
import { generateShopifyProviderConfigKey } from "@/connectors/shopify-slug";
import {
  CreateShopifyAppBodySchema,
  DeleteShopifyAppParamSchema,
} from "@/schemas/admin-shopify-apps";
import { createLogger } from "@/lib/logger";
import { getErrorMessage } from "@/connectors/tools/helpers";

const log = createLogger("admin-shopify-apps");

/** Postgres unique-constraint violation SQLSTATE. */
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === PG_UNIQUE_VIOLATION
  );
}

/** Read the client IP from forwarded headers, matching the admin middleware. */
function clientIp(c: Context): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown"
  );
}

/**
 * Emit a structured audit log entry. Spec §Security requires every admin
 * endpoint call to leave an auditable record with this exact shape.
 * Emitted via the existing pino logger pipeline — no new infrastructure.
 */
function auditAdminCall(params: {
  ip: string;
  workspaceId: string;
  action: "create_shopify_app" | "delete_shopify_app";
  result: "success" | "failure";
  adminUser: string;
  error?: string;
  providerConfigKey?: string;
}): void {
  log.info(
    {
      audit: true,
      timestamp: new Date().toISOString(),
      ip: params.ip,
      workspace_id: params.workspaceId,
      action: params.action,
      result: params.result,
      admin_user: params.adminUser,
      provider_config_key: params.providerConfigKey,
      error: params.error,
    },
    "admin audit",
  );
}

/**
 * POST /cowork/admin/shopify-apps
 *
 * DB-first two-phase commit:
 *   1. Validate input
 *   2. Check slot is free
 *   3. Generate provider_config_key
 *   4. Insert row with status='pending' (catches 23505 as a 409 to close TOCTOU)
 *   5. Create Nango integration
 *   6. On success: promote row to 'active'
 *      On failure: mark row 'failed', return 502
 */
export async function createShopifyAppHandler(c: Context) {
  const ip = clientIp(c);
  const adminUser = (c.get("adminUser") as string | undefined) ?? "unknown";
  let workspaceIdForAudit = "";

  try {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = CreateShopifyAppBodySchema.safeParse(raw);
    if (!parsed.success) {
      auditAdminCall({
        ip,
        workspaceId: "",
        action: "create_shopify_app",
        result: "failure",
        adminUser,
        error: "invalid_body",
      });
      return c.json(
        { error: "Invalid request body", details: parsed.error.issues },
        400,
      );
    }

    const nango = getNango();
    if (!nango) {
      auditAdminCall({
        ip,
        workspaceId: parsed.data.workspace_id,
        action: "create_shopify_app",
        result: "failure",
        adminUser,
        error: "nango_not_configured",
      });
      return c.json({ error: "Nango not configured" }, 503);
    }

    const body = parsed.data;
    workspaceIdForAudit = body.workspace_id;

    // Slot check — active or pending rows both block re-provisioning.
    // Best-effort; the real guarantee comes from the 23505 catch below.
    const existing = await getAnyActiveOrPendingShopifyApp(body.workspace_id);
    if (existing) {
      auditAdminCall({
        ip,
        workspaceId: body.workspace_id,
        action: "create_shopify_app",
        result: "failure",
        adminUser,
        error: "slot_occupied",
      });
      return c.json(
        {
          error: "Workspace already has a Shopify app provisioned or in-progress",
          status: existing.status,
        },
        409,
      );
    }

    const providerConfigKey = generateShopifyProviderConfigKey(body.app_name);
    const clientIdLast4 = body.client_id.slice(-4);

    // Phase 1: DB row lands in 'pending' before any external side effect.
    // Catch the Postgres 23505 unique-violation to close the check-then-insert
    // TOCTOU race: if two concurrent requests pass the slot check, only one
    // succeeds at the insert; the second sees 23505 and returns 409 cleanly.
    try {
      await insertPendingShopifyApp({
        workspaceId: body.workspace_id,
        providerConfigKey,
        appName: body.app_name,
        clientIdLast4,
        storeDomain: body.store_domain ?? null,
        scopes: body.scopes,
        createdBy: adminUser,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        auditAdminCall({
          ip,
          workspaceId: body.workspace_id,
          action: "create_shopify_app",
          result: "failure",
          adminUser,
          error: "slot_race",
        });
        return c.json(
          {
            error: "Workspace already has a Shopify app provisioned or in-progress",
          },
          409,
        );
      }
      throw err;
    }

    log.info(
      { workspaceId: body.workspace_id, providerConfigKey, adminUser },
      "inserted pending shopify app row",
    );

    // Phase 2: create the Nango integration
    try {
      await nango.createIntegration({
        provider: "shopify",
        unique_key: providerConfigKey,
        display_name: body.app_name,
        credentials: {
          type: "OAUTH2",
          client_id: body.client_id,
          client_secret: body.client_secret,
          scopes: body.scopes.join(","),
        },
      });
    } catch (err) {
      log.error(
        { err, workspaceId: body.workspace_id, providerConfigKey },
        "nango createIntegration failed",
      );
      await markShopifyAppFailed(body.workspace_id);
      auditAdminCall({
        ip,
        workspaceId: body.workspace_id,
        action: "create_shopify_app",
        result: "failure",
        adminUser,
        providerConfigKey,
        error: getErrorMessage(err),
      });
      return c.json(
        {
          error: "Nango integration creation failed",
          detail: getErrorMessage(err),
          workspace_id: body.workspace_id,
          status: "failed",
        },
        502,
      );
    }

    // Phase 2 complete — promote to active
    await promoteShopifyAppToActive(body.workspace_id);

    log.info(
      { workspaceId: body.workspace_id, providerConfigKey },
      "shopify app provisioned",
    );
    auditAdminCall({
      ip,
      workspaceId: body.workspace_id,
      action: "create_shopify_app",
      result: "success",
      adminUser,
      providerConfigKey,
    });

    return c.json(
      {
        provider_config_key: providerConfigKey,
        app_name: body.app_name,
        store_domain: body.store_domain ?? null,
        status: "active",
      },
      200,
    );
  } catch (err) {
    log.error({ err }, "createShopifyAppHandler unexpected error");
    auditAdminCall({
      ip,
      workspaceId: workspaceIdForAudit,
      action: "create_shopify_app",
      result: "failure",
      adminUser,
      error: getErrorMessage(err),
    });
    return c.json(
      { error: getErrorMessage(err) || "Internal error" },
      500,
    );
  }
}

/**
 * DELETE /cowork/admin/shopify-apps/:workspace_id
 *
 * Status-first teardown:
 *   1. Flip row to 'deleting' (and stop serving it for new OAuth sessions)
 *   2. Invalidate caches
 *   3. Delete all Nango connections for that workspace+key
 *   4. Delete the Nango integration
 *   5. Set disabled_at
 *
 * Every step is idempotent against Nango's "not found" responses.
 */
export async function deleteShopifyAppHandler(c: Context) {
  const ip = clientIp(c);
  const adminUser = (c.get("adminUser") as string | undefined) ?? "unknown";
  let workspaceIdForAudit = "";

  try {
    const parsed = DeleteShopifyAppParamSchema.safeParse({
      workspace_id: c.req.param("workspace_id"),
    });
    if (!parsed.success) {
      auditAdminCall({
        ip,
        workspaceId: "",
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        error: "invalid_param",
      });
      return c.json(
        { error: "Invalid path param", details: parsed.error.issues },
        400,
      );
    }

    const nango = getNango();
    if (!nango) {
      auditAdminCall({
        ip,
        workspaceId: parsed.data.workspace_id,
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        error: "nango_not_configured",
      });
      return c.json({ error: "Nango not configured" }, 503);
    }

    const { workspace_id } = parsed.data;
    workspaceIdForAudit = workspace_id;

    // Ensure there is an active row at all
    const active = await getActiveShopifyApp(workspace_id);
    if (!active) {
      auditAdminCall({
        ip,
        workspaceId: workspace_id,
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        error: "not_found",
      });
      return c.json({ error: "No active Shopify app for workspace" }, 404);
    }

    // Flip to 'deleting' — only succeeds if the row is still active
    const providerConfigKey = await markShopifyAppDeleting(workspace_id);
    if (!providerConfigKey) {
      auditAdminCall({
        ip,
        workspaceId: workspace_id,
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        error: "not_active",
      });
      return c.json({ error: "App is not in an active state" }, 409);
    }

    // Invalidate caches immediately so in-flight chat requests see the flip
    invalidateConnectionsCache(workspace_id);
    invalidateProcessorCache(workspace_id);

    let deletedConnections = 0;
    try {
      const result = await nango.listConnections({
        tags: { end_user_id: workspace_id },
      });
      for (const conn of result.connections) {
        if (conn.provider_config_key !== providerConfigKey) continue;
        try {
          await nango.deleteConnection(providerConfigKey, conn.connection_id);
          deletedConnections += 1;
        } catch (err) {
          log.warn(
            { err, workspace_id, connectionId: conn.connection_id },
            "failed to delete nango connection (will be retried by reconcile)",
          );
        }
      }
    } catch (err) {
      log.warn({ err, workspace_id }, "listConnections failed during delete — row stays in 'deleting' for reconcile");
      auditAdminCall({
        ip,
        workspaceId: workspace_id,
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        providerConfigKey,
        error: `teardown_incomplete:list_connections:${getErrorMessage(err)}`,
      });
      return c.json(
        {
          error: "Teardown incomplete; reconcile job will retry",
          detail: getErrorMessage(err),
        },
        202,
      );
    }

    try {
      await nango.deleteIntegration(providerConfigKey);
    } catch (err) {
      log.warn({ err, workspace_id, providerConfigKey }, "deleteIntegration failed — row stays in 'deleting' for reconcile");
      auditAdminCall({
        ip,
        workspaceId: workspace_id,
        action: "delete_shopify_app",
        result: "failure",
        adminUser,
        providerConfigKey,
        error: `teardown_incomplete:delete_integration:${getErrorMessage(err)}`,
      });
      return c.json(
        {
          error: "Teardown incomplete; reconcile job will retry",
          detail: getErrorMessage(err),
        },
        202,
      );
    }

    await finalizeShopifyAppSoftDelete(workspace_id);

    log.info(
      { workspace_id, providerConfigKey, deletedConnections },
      "shopify app torn down",
    );
    auditAdminCall({
      ip,
      workspaceId: workspace_id,
      action: "delete_shopify_app",
      result: "success",
      adminUser,
      providerConfigKey,
    });

    return c.json({ success: true, deleted_connections: deletedConnections }, 200);
  } catch (err) {
    log.error({ err }, "deleteShopifyAppHandler unexpected error");
    auditAdminCall({
      ip,
      workspaceId: workspaceIdForAudit,
      action: "delete_shopify_app",
      result: "failure",
      adminUser,
      error: getErrorMessage(err),
    });
    return c.json(
      { error: getErrorMessage(err) || "Internal error" },
      500,
    );
  }
}
```

- [ ] **Step 4: Run the tests and verify the POST tests pass**

Run: `npm test -- --run src/routes/admin/__tests__/shopify-apps.test.ts`
Expected: all 6 POST tests pass (invalid body, 503, 409 pre-check, 409 TOCTOU race, happy path, 502). The DELETE tests will be added in Phase 5.

If the "happy path" test fails because the generated slug doesn't match the expected regex, inspect the slug — it should be `shopify-acmeshopifyapp-xxxxxx` because the slug is derived by stripping non-alphanumerics from `"ACME Shopify App"` and lowercasing. If the test expects a different shape, the test is wrong; do not weaken the regex.

- [ ] **Step 5: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/routes/admin/shopify-apps.ts src/routes/admin/__tests__/shopify-apps.test.ts
git commit -m "feat(admin): add POST /admin/shopify-apps with two-phase commit

Provisions per-client Shopify apps via a DB-first flow:
  1. Insert row with status='pending'
  2. Call nango.createIntegration
  3. On success: promote to 'active'
     On failure: mark 'failed' and return 502

The row always exists in the DB first, so a crash between Nango
create and DB promote leaves a reconcile-visible 'pending' row
rather than an orphan integration."
```

---

## Phase 5 — Admin DELETE endpoint tests

The DELETE handler implementation was already written in Task 4.4 alongside the POST handler (they share a file). This phase adds its tests.

### Task 5.1: Integration tests for DELETE

**Files:**
- Modify: `src/routes/admin/__tests__/shopify-apps.test.ts`

- [ ] **Step 1: Append DELETE tests to the existing spec file**

Add the following to `src/routes/admin/__tests__/shopify-apps.test.ts`. The `vi.mock` calls for `@/connectors/nango/connections` and `@/connectors/build-toolset` are already declared in Phase 4's Step 1 (they were placed there specifically so Phase 5 doesn't need to redeclare them — vitest hoists all `vi.mock` to the top of the file regardless of declaration order).

Add these imports near the existing imports at the top of the file:

```typescript
import {
  markShopifyAppDeleting,
  finalizeShopifyAppSoftDelete,
} from "@/db/queries/shopify-apps";
import { deleteShopifyAppHandler } from "@/routes/admin/shopify-apps";
import { invalidateConnectionsCache } from "@/connectors/nango/connections";
import { invalidateProcessorCache } from "@/connectors/build-toolset";
```

Then append the new `describe` block at the end of the file:

```typescript
/**
 * Build a minimal Hono-shaped mock context for DELETE. Key-aware `get` so
 * handlers that read c.get("adminUser") work without also accidentally
 * returning a user object for c.get("authUser").
 */
function makeDeleteCtx(
  workspaceId: string,
  opts: { adminUser?: string } = {},
): Context {
  const adminUser = opts.adminUser ?? "op@marketmint";
  return {
    req: {
      param: vi.fn().mockReturnValue(workspaceId),
      path: `/api/cowork/admin/shopify-apps/${workspaceId}`,
      method: "DELETE",
      header: vi.fn().mockReturnValue(undefined),
    },
    get: vi.fn((key: string) => (key === "adminUser" ? adminUser : undefined)),
    json: vi.fn((payload, status) => ({ payload, status })),
  } as unknown as Context;
}

describe("DELETE /admin/shopify-apps/:workspace_id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 404 when no active row exists", async () => {
    (getActiveShopifyApp as any).mockResolvedValue(null);
    (getNango as any).mockReturnValue({});
    const res: any = await deleteShopifyAppHandler(makeDeleteCtx("ws1"));
    expect(res.status).toBe(404);
  });

  it("happy path: flips deleting, invalidates caches, deletes connections and integration, finalizes soft-delete", async () => {
    (getActiveShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      status: "active",
    });
    (markShopifyAppDeleting as any).mockResolvedValue("shopify-acme-abc123");
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    const deleteIntegration = vi.fn().mockResolvedValue(undefined);
    const listConnections = vi.fn().mockResolvedValue({
      connections: [
        { provider_config_key: "shopify-acme-abc123", connection_id: "conn1" },
        { provider_config_key: "meta-marketing-api", connection_id: "conn2" },
      ],
    });
    (getNango as any).mockReturnValue({ listConnections, deleteConnection, deleteIntegration });
    (finalizeShopifyAppSoftDelete as any).mockResolvedValue(undefined);

    const res: any = await deleteShopifyAppHandler(makeDeleteCtx("ws1"));

    expect(invalidateConnectionsCache).toHaveBeenCalledWith("ws1");
    expect(invalidateProcessorCache).toHaveBeenCalledWith("ws1");
    expect(deleteConnection).toHaveBeenCalledTimes(1);
    expect(deleteConnection).toHaveBeenCalledWith("shopify-acme-abc123", "conn1");
    expect(deleteIntegration).toHaveBeenCalledWith("shopify-acme-abc123");
    expect(finalizeShopifyAppSoftDelete).toHaveBeenCalledWith("ws1");
    expect(res.status).toBe(200);
    expect(res.payload).toEqual({ success: true, deleted_connections: 1 });
  });

  it("returns 409 when markShopifyAppDeleting returns null (concurrent delete)", async () => {
    (getActiveShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      status: "active",
    });
    (markShopifyAppDeleting as any).mockResolvedValue(null);
    (getNango as any).mockReturnValue({});
    const res: any = await deleteShopifyAppHandler(makeDeleteCtx("ws1"));
    expect(res.status).toBe(409);
  });

  it("returns 202 when deleteIntegration fails — reconcile will retry", async () => {
    (getActiveShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      status: "active",
    });
    (markShopifyAppDeleting as any).mockResolvedValue("shopify-acme-abc123");
    (getNango as any).mockReturnValue({
      listConnections: vi.fn().mockResolvedValue({ connections: [] }),
      deleteIntegration: vi.fn().mockRejectedValue(new Error("nango down")),
    });

    const res: any = await deleteShopifyAppHandler(makeDeleteCtx("ws1"));
    expect(res.status).toBe(202);
    expect(finalizeShopifyAppSoftDelete).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test file**

Run: `npm test -- --run src/routes/admin/__tests__/shopify-apps.test.ts`
Expected: all 6 POST tests + 4 DELETE tests pass (10 total).

- [ ] **Step 3: Commit**

```bash
git add src/routes/admin/__tests__/shopify-apps.test.ts
git commit -m "test(admin): cover DELETE /admin/shopify-apps flow"
```

---

## Phase 6 — Connect-session integration

### Task 6.1: Extend connect-session to resolve the per-workspace Shopify app

**Files:**
- Modify: `src/routes/connectors.ts`
- Create: `src/routes/__tests__/connectors-shopify.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/routes/__tests__/connectors-shopify.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/connectors/nango/client", () => ({ getNango: vi.fn() }));
vi.mock("@/db/queries/shopify-apps", () => ({
  getActiveShopifyApp: vi.fn(),
}));
vi.mock("@/connectors/nango/connections", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getUserConnections: vi.fn(),
    invalidateConnectionsCache: vi.fn(),
  };
});
vi.mock("@/connectors/build-toolset", async (importOriginal) => {
  const actual = await importOriginal<any>();
  return { ...actual, invalidateProcessorCache: vi.fn() };
});

import type { Context } from "hono";
import { getNango } from "@/connectors/nango/client";
import { getActiveShopifyApp } from "@/db/queries/shopify-apps";
import { getUserConnections } from "@/connectors/nango/connections";
import { connectSessionHandler } from "@/routes/connectors";

function makeCtx(body: unknown, orgId = "ws1"): Context {
  return {
    req: {
      json: vi.fn().mockResolvedValue(body),
    },
    get: vi.fn((key: string) => {
      if (key === "authUser") return { id: "user1", orgId };
      return undefined;
    }),
    json: vi.fn((payload, status) => ({ payload, status })),
  } as unknown as Context;
}

describe("connectSessionHandler — Shopify resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 422 when requesting Shopify but workspace has no app provisioned", async () => {
    (getNango as any).mockReturnValue({
      createConnectSession: vi.fn(),
    });
    (getActiveShopifyApp as any).mockResolvedValue(null);
    (getUserConnections as any).mockResolvedValue({});

    const res: any = await connectSessionHandler(makeCtx({ integrationId: "shopify" }));
    expect(res.status).toBe(422);
    expect(res.payload.error).toMatch(/No Shopify app provisioned/i);
  });

  it("returns 409 when workspace already has an active Shopify connection", async () => {
    (getNango as any).mockReturnValue({
      createConnectSession: vi.fn(),
    });
    (getActiveShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      status: "active",
    });
    (getUserConnections as any).mockResolvedValue({
      shopify: {
        providerConfigKey: "shopify-acme-abc123",
        connectionId: "conn-existing",
      },
    });

    const res: any = await connectSessionHandler(makeCtx({ integrationId: "shopify" }));
    expect(res.status).toBe(409);
  });

  it("happy path: resolves workspace's provider_config_key and passes it to nango", async () => {
    const createConnectSession = vi
      .fn()
      .mockResolvedValue({ data: { token: "sess_abc" } });
    (getNango as any).mockReturnValue({ createConnectSession });
    (getActiveShopifyApp as any).mockResolvedValue({
      workspaceId: "ws1",
      providerConfigKey: "shopify-acme-abc123",
      status: "active",
    });
    (getUserConnections as any).mockResolvedValue({});

    const res: any = await connectSessionHandler(makeCtx({ integrationId: "shopify" }));

    expect(createConnectSession).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_integrations: ["shopify-acme-abc123"],
        tags: { end_user_id: "ws1" },
      }),
    );
    expect(res.status).toBeUndefined(); // c.json(payload) with no status = 200
    expect(res.payload).toEqual({
      sessionToken: "sess_abc",
      providerConfigKey: "shopify-acme-abc123",
    });
  });

  it("non-shopify integration path is unchanged and does not call getActiveShopifyApp", async () => {
    const createConnectSession = vi
      .fn()
      .mockResolvedValue({ data: { token: "sess_meta" } });
    (getNango as any).mockReturnValue({ createConnectSession });

    const res: any = await connectSessionHandler(
      makeCtx({ integrationId: "meta-ads" }),
    );

    expect(getActiveShopifyApp).not.toHaveBeenCalled();
    expect(createConnectSession).toHaveBeenCalledWith(
      expect.objectContaining({
        allowed_integrations: ["meta-marketing-api"],
      }),
    );
    expect(res.payload.sessionToken).toBe("sess_meta");
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npm test -- --run src/routes/__tests__/connectors-shopify.test.ts`
Expected: FAIL — the current handler doesn't call `getActiveShopifyApp`, doesn't return 422/409, and doesn't include `providerConfigKey` in the response.

- [ ] **Step 3: Update `connectSessionHandler` to implement Shopify resolution**

Open `src/routes/connectors.ts`. At the top of the file, add imports:

```typescript
import { getActiveShopifyApp } from "@/db/queries/shopify-apps";
```

Inside `connectSessionHandler`, replace the block starting at "Resolve the frontend connector id" through the `createConnectSession` call with the new logic. The final handler body (from after the body-parsing block to before the `return c.json(...)`) should be:

```typescript
    log.info({ workspaceId, userId: c.get("authUser")?.id }, "creating connect session");

    // Resolve the frontend connector id to Nango's provider_config_key
    // (e.g. "meta-ads" -> "meta-marketing-api"; "shopify" -> per-workspace key)
    let nangoIntegrationKey: string | undefined;
    if (parsed.data.integrationId) {
      const connector = getConnectorById(parsed.data.integrationId);
      nangoIntegrationKey = connector?.providerConfigKey ?? parsed.data.integrationId;
    }

    // Shopify gets workspace-specific routing via the per-client app registry
    if (parsed.data.integrationId === "shopify") {
      const shopifyApp = await getActiveShopifyApp(workspaceId);
      if (!shopifyApp) {
        return c.json(
          {
            error: "No Shopify app provisioned for this workspace. Contact support.",
          },
          422,
        );
      }
      nangoIntegrationKey = shopifyApp.providerConfigKey;

      // Single-store guard: refuse if workspace already has an active Shopify connection
      const existing = await getUserConnections(workspaceId);
      if (existing.shopify) {
        return c.json(
          {
            error:
              "This workspace already has Shopify connected. Disconnect first or use a separate workspace.",
          },
          409,
        );
      }
    }

    const { data } = await nango.createConnectSession({
      tags: { end_user_id: workspaceId },
      allowed_integrations: nangoIntegrationKey ? [nangoIntegrationKey] : undefined,
    });

    // Pre-emptively invalidate caches — the user is about to connect a new service.
    // Next chat message after OAuth completes will get fresh connections.
    invalidateConnectionsCache(workspaceId);
    invalidateProcessorCache(workspaceId);

    return c.json({
      sessionToken: data.token,
      providerConfigKey: nangoIntegrationKey,
    });
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npm test -- --run src/routes/__tests__/connectors-shopify.test.ts`
Expected: all 4 tests pass.

- [ ] **Step 5: Run the entire test suite as a regression check**

Run: `npm test -- --run`
Expected: all tests still pass (including existing ones).

- [ ] **Step 6: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/routes/connectors.ts src/routes/__tests__/connectors-shopify.test.ts
git commit -m "feat(connectors): resolve per-workspace shopify app in connect-session

Extends connectSessionHandler so a 'shopify' connect request looks up
the workspace's row in shopify_apps. Returns 422 when no app is
provisioned, 409 when a connection already exists, and includes the
resolved providerConfigKey in the response for the UI."
```

---

## Phase 7 — Reconcile job

### Task 7.1: Reconcile function for stuck rows

**Files:**
- Create: `src/jobs/reconcile-shopify-apps.ts`
- Create: `src/jobs/__tests__/reconcile-shopify-apps.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/jobs/__tests__/reconcile-shopify-apps.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/connectors/nango/client", () => ({ getNango: vi.fn() }));
vi.mock("@/db/queries/shopify-apps", () => ({
  listStuckShopifyApps: vi.fn(),
  promoteShopifyAppToActive: vi.fn(),
  markShopifyAppFailed: vi.fn(),
  finalizeShopifyAppSoftDelete: vi.fn(),
}));

import { getNango } from "@/connectors/nango/client";
import {
  listStuckShopifyApps,
  promoteShopifyAppToActive,
  markShopifyAppFailed,
  finalizeShopifyAppSoftDelete,
} from "@/db/queries/shopify-apps";
import { runReconcile } from "@/jobs/reconcile-shopify-apps";

describe("reconcile-shopify-apps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("promotes pending row when Nango integration exists", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "pending",
      },
    ]);
    (getNango as any).mockReturnValue({
      getIntegration: vi.fn().mockResolvedValue({ data: {} }),
    });

    await runReconcile();

    expect(promoteShopifyAppToActive).toHaveBeenCalledWith("ws1");
    expect(markShopifyAppFailed).not.toHaveBeenCalled();
  });

  it("marks pending row failed when Nango integration is missing", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "pending",
      },
    ]);
    (getNango as any).mockReturnValue({
      getIntegration: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    });

    await runReconcile();

    expect(markShopifyAppFailed).toHaveBeenCalledWith("ws1");
  });

  it("finalizes soft-delete for deleting row when integration is gone", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "deleting",
      },
    ]);
    (getNango as any).mockReturnValue({
      getIntegration: vi.fn().mockRejectedValue({ response: { status: 404 } }),
    });

    await runReconcile();

    expect(finalizeShopifyAppSoftDelete).toHaveBeenCalledWith("ws1");
  });

  it("retries teardown when deleting row still has an integration", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "deleting",
      },
    ]);
    const deleteIntegration = vi.fn().mockResolvedValue(undefined);
    const deleteConnection = vi.fn().mockResolvedValue(undefined);
    (getNango as any).mockReturnValue({
      getIntegration: vi.fn().mockResolvedValue({ data: {} }),
      listConnections: vi.fn().mockResolvedValue({ connections: [] }),
      deleteIntegration,
      deleteConnection,
    });

    await runReconcile();

    expect(deleteIntegration).toHaveBeenCalledWith("shopify-acme-abc123");
    expect(finalizeShopifyAppSoftDelete).toHaveBeenCalledWith("ws1");
  });

  it("is a no-op when Nango is unreachable", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "pending",
      },
    ]);
    (getNango as any).mockReturnValue(null);

    await runReconcile();

    expect(promoteShopifyAppToActive).not.toHaveBeenCalled();
    expect(markShopifyAppFailed).not.toHaveBeenCalled();
  });

  it("is a no-op when no stuck rows exist", async () => {
    (listStuckShopifyApps as any).mockResolvedValue([]);
    (getNango as any).mockReturnValue({ getIntegration: vi.fn() });

    await runReconcile();

    expect(promoteShopifyAppToActive).not.toHaveBeenCalled();
  });

  it("rethrows (does not treat as missing) when getIntegration throws an unknown error shape", async () => {
    // Simulates a future Nango SDK upgrade wrapping errors in a shape
    // without `response.status`. We MUST NOT silently mark the row failed.
    (listStuckShopifyApps as any).mockResolvedValue([
      {
        workspaceId: "ws1",
        providerConfigKey: "shopify-acme-abc123",
        status: "pending",
      },
    ]);
    (getNango as any).mockReturnValue({
      getIntegration: vi.fn().mockRejectedValue(new Error("unexpected error shape")),
    });

    await runReconcile();

    // Neither terminal state should be reached — the row stays in 'pending'
    // and will be retried next tick.
    expect(promoteShopifyAppToActive).not.toHaveBeenCalled();
    expect(markShopifyAppFailed).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `npm test -- --run src/jobs/__tests__/reconcile-shopify-apps.test.ts`
Expected: FAIL — `runReconcile` does not exist yet.

- [ ] **Step 3: Implement the reconcile function**

Create `src/jobs/reconcile-shopify-apps.ts`:

```typescript
import { getNango } from "@/connectors/nango/client";
import {
  finalizeShopifyAppSoftDelete,
  listStuckShopifyApps,
  markShopifyAppFailed,
  promoteShopifyAppToActive,
} from "@/db/queries/shopify-apps";
import { createLogger } from "@/lib/logger";

const log = createLogger("reconcile-shopify-apps");

const STUCK_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Reconcile stuck shopify_apps rows.
 *
 * pending: crash between Nango create and DB promote.
 *   - If Nango integration exists -> promote to active.
 *   - If missing -> mark failed.
 *
 * deleting: crash or failure during teardown.
 *   - If Nango integration missing -> finalize soft-delete.
 *   - If still present -> retry teardown and finalize.
 *
 * Safe to run concurrently with fresh provisioning because it only
 * acts on rows updated more than STUCK_THRESHOLD_MS ago.
 */
export async function runReconcile(): Promise<void> {
  const nango = getNango();
  if (!nango) {
    log.warn("Nango not configured; skipping reconcile");
    return;
  }

  const stuck = await listStuckShopifyApps(STUCK_THRESHOLD_MS);
  if (stuck.length === 0) {
    log.debug("no stuck rows");
    return;
  }

  log.info({ count: stuck.length }, "reconciling stuck shopify_apps rows");

  for (const row of stuck) {
    try {
      if (row.status === "pending") {
        await reconcilePending(nango, row.workspaceId, row.providerConfigKey);
      } else if (row.status === "deleting") {
        await reconcileDeleting(nango, row.workspaceId, row.providerConfigKey);
      }
    } catch (err) {
      log.error(
        { err, workspaceId: row.workspaceId, providerConfigKey: row.providerConfigKey, status: row.status },
        "reconcile iteration failed; will retry next tick",
      );
    }
  }
}

/**
 * Check whether a Nango integration exists.
 *
 * Tightly coupled to the `@nangohq/node` SDK's error shape: a missing
 * integration surfaces as an AxiosError-like object with `err.response.status === 404`.
 * If a future SDK upgrade wraps errors in a different shape that lacks
 * `response.status`, we DO NOT want to silently treat that as "integration
 * missing" (which would permanently mark rows `failed` or drop `deleting`
 * rows into a finalized state without actually tearing down Nango resources).
 * Unknown error shapes rethrow — the reconcile loop's outer catch logs and
 * retries on the next cron tick.
 */
async function integrationExists(
  nango: NonNullable<ReturnType<typeof getNango>>,
  providerConfigKey: string,
): Promise<boolean> {
  try {
    await nango.getIntegration({ uniqueKey: providerConfigKey });
    return true;
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    if (status === 404) return false;
    if (typeof status === "number") {
      // Known-shape non-404 error (502/503/etc) — surface to the outer catch
      // for retry.
      throw err;
    }
    // Unknown shape — rethrow rather than guessing. Do not collapse into
    // "missing", which would trigger destructive reconcile actions.
    log.error({ err, providerConfigKey }, "integrationExists saw unknown error shape; rethrowing for retry");
    throw err;
  }
}

async function reconcilePending(
  nango: NonNullable<ReturnType<typeof getNango>>,
  workspaceId: string,
  providerConfigKey: string,
): Promise<void> {
  const exists = await integrationExists(nango, providerConfigKey);
  if (exists) {
    log.info({ workspaceId, providerConfigKey }, "pending row -> active (integration exists)");
    await promoteShopifyAppToActive(workspaceId);
  } else {
    log.warn({ workspaceId, providerConfigKey }, "pending row -> failed (integration missing)");
    await markShopifyAppFailed(workspaceId);
  }
}

async function reconcileDeleting(
  nango: NonNullable<ReturnType<typeof getNango>>,
  workspaceId: string,
  providerConfigKey: string,
): Promise<void> {
  const exists = await integrationExists(nango, providerConfigKey);
  if (!exists) {
    log.info({ workspaceId, providerConfigKey }, "deleting row -> finalized (integration gone)");
    await finalizeShopifyAppSoftDelete(workspaceId);
    return;
  }

  log.info({ workspaceId, providerConfigKey }, "deleting row: retrying teardown");
  const connections = await nango.listConnections({
    tags: { end_user_id: workspaceId },
  });
  for (const conn of connections.connections) {
    if (conn.provider_config_key !== providerConfigKey) continue;
    try {
      await nango.deleteConnection(providerConfigKey, conn.connection_id);
    } catch (err) {
      log.warn({ err, workspaceId, connectionId: conn.connection_id }, "retry deleteConnection failed");
    }
  }
  await nango.deleteIntegration(providerConfigKey);
  await finalizeShopifyAppSoftDelete(workspaceId);
}
```

- [ ] **Step 4: Run the reconcile tests and verify they pass**

Run: `npm test -- --run src/jobs/__tests__/reconcile-shopify-apps.test.ts`
Expected: all 7 tests pass.

If the "missing integration" cases fail, inspect the `integrationExists` helper — the Nango SDK throws an `AxiosError`-shaped object where the HTTP status is at `err.response.status`. The tests mock exactly that shape. The "unknown error shape" test exists specifically to catch the case where that shape changes in a future SDK upgrade.

- [ ] **Step 5: Commit**

```bash
git add src/jobs/reconcile-shopify-apps.ts src/jobs/__tests__/reconcile-shopify-apps.test.ts
git commit -m "feat(jobs): add shopify_apps reconcile function

Implements runReconcile() to clean up stuck pending and deleting
rows. For pending rows it promotes to active when the Nango
integration exists, or marks failed when missing. For deleting
rows it retries teardown and finalizes the soft-delete."
```

### Task 7.2: Wire the reconcile job to a Trigger.dev cron

The reconcile function is the reliability backbone of the two-phase commit — the DELETE handler explicitly returns 202 for teardown failures with "reconcile job will retry", so the job must actually be running on a schedule in every environment.

**Files:**
- Create: `src/trigger/reconcile-shopify-apps.ts`

- [ ] **Step 1: Read the existing Trigger.dev scheduled task for the shape**

Read `src/trigger/agent-job-executor.ts`. Note the pattern: `schedules.task({ id, maxDuration, machine, queue, retry, run })`. The cron expression is NOT in the code — Trigger.dev schedules are registered externally via the dashboard or via `schedules.create`. The code only declares the task and handles one invocation.

For the reconcile task, we only need the task declaration — registering the schedule (`*/5 * * * *`) is a one-time dashboard action at deploy time. Document this in the commit message so the operator running the rollout knows to attach the cron.

- [ ] **Step 2: Create the scheduled task wrapper**

Write `src/trigger/reconcile-shopify-apps.ts`:

```typescript
import { schedules } from "@trigger.dev/sdk/v3";
import { runReconcile } from "@/jobs/reconcile-shopify-apps";

const MAX_DURATION_SECONDS = 120; // Plenty for <100 stuck rows
const MACHINE_TYPE = "small-1x";

/**
 * Scheduled reconcile for stuck shopify_apps rows.
 *
 * Cron: every 5 minutes — fine-grained enough to bound the orphan-window
 * for a crash between Nango create and DB promote. The job itself only
 * acts on rows updated more than STUCK_THRESHOLD_MS (5 min) ago so it
 * never races with an in-flight admin POST/DELETE.
 *
 * Schedule is NOT configured in code. Attach `*\/5 * * * *` via the
 * Trigger.dev dashboard (or `schedules.create`) during the cowork
 * deployment step of the rollout. The task id "reconcile-shopify-apps"
 * is the handle for that operation.
 */
export const reconcileShopifyAppsTask = schedules.task({
  id: "reconcile-shopify-apps",
  maxDuration: MAX_DURATION_SECONDS,
  machine: MACHINE_TYPE,
  queue: {
    name: "reconcile-shopify-apps",
  },
  retry: {
    maxAttempts: 3,
    factor: 2,
    minTimeoutInMs: 1_000,
    maxTimeoutInMs: 10_000,
    randomize: false,
  },
  run: async () => {
    await runReconcile();
  },
});
```

- [ ] **Step 3: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify the task file is picked up by Trigger.dev's build**

Read `trigger.config.ts` at the repo root. Verify the `dirs` array includes `./src/trigger` (it almost certainly does, since `agent-job-executor.ts` lives there and is already deployed). If it doesn't, add it — but do not make other changes to the config.

- [ ] **Step 5: Commit**

```bash
git add src/trigger/reconcile-shopify-apps.ts
git commit -m "feat(trigger): schedule reconcile-shopify-apps task

Wraps runReconcile() in a Trigger.dev scheduled task. After
deploy, attach the '*/5 * * * *' cron in the Trigger.dev
dashboard (or via schedules.create) using task id
'reconcile-shopify-apps'. The task itself is idempotent and
safe to run concurrently with in-flight admin writes."
```

---

## Phase 8 — Final wiring and end-to-end verification

### Task 8.1: Register the admin routes

**Files:**
- Modify: `src/mastra/index.ts`

- [ ] **Step 1: Add imports**

In `src/mastra/index.ts`, add after the existing `connectors` imports (around line 20):

```typescript
import {
  createShopifyAppHandler,
  deleteShopifyAppHandler,
} from "@/routes/admin/shopify-apps";
import { adminAuthMiddleware } from "@/middleware/admin-auth";
```

- [ ] **Step 2: Register the two routes**

In the `apiRoutes` array inside `server`, add these entries immediately after the existing `/cowork/connectors/disconnect` route (around line 114):

```typescript
      registerApiRoute("/cowork/admin/shopify-apps", {
        method: "POST",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, adminAuthMiddleware],
        handler: createShopifyAppHandler,
      }),
      registerApiRoute("/cowork/admin/shopify-apps/:workspace_id", {
        method: "DELETE",
        requiresAuth: false,
        middleware: [sentryMiddleware, requestLogger, adminAuthMiddleware],
        handler: deleteShopifyAppHandler,
      }),
```

Note the admin endpoints intentionally do NOT use `clerkAuthMiddleware` — they are gated by `adminAuthMiddleware` instead (service token, no user session).

- [ ] **Step 3: Run the compiler**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Run the full test suite**

Run: `npm test -- --run`
Expected: all tests pass.

- [ ] **Step 5: Run the Mastra build**

Run: `npm run build`
Expected: build succeeds with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/mastra/index.ts
git commit -m "feat(mastra): register admin shopify-apps routes

Adds POST and DELETE endpoints under /cowork/admin/shopify-apps
behind the adminAuthMiddleware service-token gate."
```

### Task 8.2: Quality gate — run every check before shipping

This task is non-negotiable before declaring Phase 8 done. It catches regressions that slipped past any individual phase's test run.

**Files:** none — verification only.

- [ ] **Step 1: Full TypeScript compile**

Run: `npx tsc --noEmit`
Expected: zero errors across the entire codebase, not just new files. If this fails, a Phase 1–7 change regressed a file that wasn't part of any task's test run.

- [ ] **Step 2: Full test suite (not just files touched)**

Run: `npm test -- --run`
Expected: every test passes. Watch for tests that were previously passing and now fail — those are regressions from the type signature change (Phase 1) or the `Connections` map normalization (Phase 2). If a non-Shopify test fails, inspect the failure before touching any file — Phase 1's signature change should not affect non-Shopify tools at runtime.

- [ ] **Step 3: Full Mastra build**

Run: `npm run build`
Expected: build succeeds. This exercises more code paths than `tsc --noEmit` alone because Mastra has its own bundling pass.

- [ ] **Step 4: Grep for leftover `"shopify"` literals in nangoProxy calls**

Run: `grep -n '"shopify"' src/connectors/tools/shopify/*.ts`
Expected output should only show:
- The `.enum(["shopify", "fulfillment_service"])` line (Shopify API value, NOT a Nango key).
- Any `"shopify"` in description strings or comments.

NO line should show `nangoProxy(\n    "shopify",`. If any does, Phase 1 missed a call site.

- [ ] **Step 5: Grep for unused imports**

Run: `npx tsc --noEmit --noUnusedLocals --noUnusedParameters` (or rely on editor/lint output)
Inspect any warnings. The DELETE handler imports several helpers that POST doesn't use (`markShopifyAppDeleting`, `finalizeShopifyAppSoftDelete`, `getActiveShopifyApp`, `invalidateConnectionsCache`, `invalidateProcessorCache`) — these are not dead because the DELETE handler lives in the same file and uses them. The test helper function `clientIp` is used by both handlers. If TS flags anything as genuinely unused, delete it.

- [ ] **Step 6: Commit only if Steps 1–5 all passed cleanly**

Nothing to commit from this task itself, but this is the gate — no Task 8.3 or production rollout begins until Steps 1–5 are all green.

### Task 8.3: Final integration check against a running instance (manual)

**Files:** none — this is a runtime verification step against a live server.

- [ ] **Step 1: Apply the migration to a local or staging database**

Run: `npm run db:push` (or `npm run db:migrate` if you prefer explicit migrations)
Expected: the `shopify_apps` table is created successfully. Verify with `psql $DATABASE_URL -c '\d shopify_apps'`.

- [ ] **Step 2: Set the admin token in your environment**

Add to `.env.local` (do NOT commit):
```
ADMIN_API_TOKEN=<generate a 32+ char random string, e.g. `openssl rand -hex 24`>
```

- [ ] **Step 3: Start the dev server**

Run: `npm run dev`
Expected: server boots on the configured port. Verify the logs show "admin" routes registered.

- [ ] **Step 4: Call the admin POST endpoint (without valid creds this will 502 at Nango, but the DB row should land in `pending` then `failed`)**

Run:
```bash
curl -X POST http://localhost:<PORT>/api/cowork/admin/shopify-apps \
  -H "Authorization: Bearer <your-ADMIN_API_TOKEN>" \
  -H "X-Admin-User: verification-test" \
  -H "Content-Type: application/json" \
  -d '{
    "workspace_id": "org_verification_test",
    "app_name": "Verification Test",
    "client_id": "fake_client_id_abcd",
    "client_secret": "fake_secret",
    "scopes": ["read_products"],
    "store_domain": "verification.myshopify.com"
  }'
```

Expected response: `502` with a Nango error message (because the creds are fake). Verify in Postgres that a row with `workspace_id = 'org_verification_test'` exists with `status = 'failed'`.

- [ ] **Step 5: Clean up the test row**

Run:
```sql
DELETE FROM shopify_apps WHERE workspace_id = 'org_verification_test';
```

- [ ] **Step 6: Verify auth rejection**

Run the same curl without the Authorization header — expect 401.
Run with a wrong token — expect 401.
Run with no `ADMIN_API_TOKEN` set in env — expect 503.

- [ ] **Step 7: Verify the connect-session 422 path**

Call `POST /api/cowork/connectors/connect-session` with `{"integrationId":"shopify"}` using a Clerk session for a workspace that has no `shopify_apps` row. Expected: 422 with the "No Shopify app provisioned" message.

- [ ] **Step 8: Production deployment prerequisite — TLS-only admin endpoint**

This is a deployment-time checklist item, not a code change. Before routing real traffic to `POST /api/cowork/admin/shopify-apps` in production:

1. Confirm the production ingress (Cloudflare / ALB / API Gateway / reverse proxy) terminates TLS and **redirects HTTP to HTTPS** for the `/api/cowork/admin/*` path prefix, or blocks plain HTTP entirely.
2. Verify with: `curl -v http://<production-host>/api/cowork/admin/shopify-apps` — expect a 301/308 redirect to HTTPS, or a connection-refused. If the HTTP request succeeds, the admin token is traveling in cleartext across the first hop — STOP and fix the ingress before provisioning any real credentials.
3. If the ingress can be configured with a per-path allow-list, restrict `/api/cowork/admin/*` to operator IP ranges. This is defense in depth on top of the `ADMIN_API_TOKEN` check.

The code does not (and cannot) enforce TLS — that's an infrastructure concern. This step exists so the operator doesn't silently ship the admin endpoint unencrypted.

- [ ] **Step 9: No commit for this task**

Manual verification only. If any step fails, fix the underlying bug in code (do not modify this plan) and re-run the check.

---

## Self-Review

I (the plan author) re-read the spec and checked this plan against it:

- **Data model (spec §Data Model)** — covered by Task 3.1.
- **Connector registry changes (spec §Connector Definition Changes)** — covered by Task 2.1.
- **Tool factory signature change (spec §Tool Factory Signature Change)** — covered by Tasks 1.1–1.3.
- **Connect session flow (spec §Connect Session Flow) including 422 and 409 guards** — covered by Task 6.1.
- **Listing & routing connections normalization (spec §Listing & Routing Connections)** — covered by Task 2.2.
- **Admin POST endpoint two-phase commit (spec §Admin POST)** — covered by Task 4.4.
- **Admin DELETE endpoint status-first teardown (spec §Admin DELETE)** — covered by Tasks 4.4 + 5.1.
- **Reconcile job (spec §Admin POST — reconcile job subsection, §Admin DELETE — reconcile coverage)** — covered by Task 7.1.
- **Admin auth service-token + rate limit + audit log (spec §Admin POST auth subsection, §Security)** — covered by Task 4.1.
- **`ADMIN_API_TOKEN` env schema entry (spec §Files to Create / Modify)** — covered by Task 4.1 Step 1.
- **Route registration (spec §Files to Modify: src/mastra/index.ts)** — covered by Task 8.1.
- **Testing strategy coverage (spec §Testing Strategy)** — unit tests (Tasks 2.1, 3.2, 4.3), admin POST/DELETE integration tests (Tasks 4.4, 5.1), connect-session integration tests (Task 6.1), reconcile tests (Task 7.1), smoke test (Task 8.2).

**Not covered in this plan (tracked below as cross-repo companion work):**

- Products-service changes (spec §Products Service Integration) — separate repo, separate plan.
- marketmint-ui changes (spec §marketmint-ui) — separate repo, separate plan.
- Products-service Nango webhook reconcile for the two-concurrent-OAuth race (spec §Connect Session Flow, Post-OAuth reconcile) — lives in the products service because it receives the webhook.
- Rollout order (spec §Rollout Order) — coordination across repos, tracked below.
- Disaster recovery runbook (spec §Disaster Recovery) — runbook docs, not code.

**Type consistency:** all function names and signatures referenced across tasks match:
- `createShopifyConnectorTools(connectionId, providerConfigKey)` — defined in Task 1.3, used by the registry in Task 1.2.
- `SHOPIFY_PER_CLIENT_KEY_PATTERN` — exported from `registry.ts` in Task 2.1, imported by slug generator tests in Task 4.3.
- `getActiveShopifyApp`, `getAnyActiveOrPendingShopifyApp`, `insertPendingShopifyApp`, `promoteShopifyAppToActive`, `markShopifyAppFailed`, `markShopifyAppDeleting`, `finalizeShopifyAppSoftDelete`, `listStuckShopifyApps` — all defined in Task 3.2, used consistently in Tasks 4.4, 5.1, 6.1, 7.1.
- `createShopifyAppHandler`, `deleteShopifyAppHandler` — defined in Task 4.4, registered in Task 8.1.
- `adminAuthMiddleware` — defined in Task 4.1, registered in Task 8.1.
- `runReconcile` — defined in Task 7.1, wrapped in `reconcileShopifyAppsTask` (Trigger.dev) in Task 7.2, scheduled via dashboard at deploy time.
- `auditAdminCall`, `clientIp`, `isUniqueViolation`, `PG_UNIQUE_VIOLATION` — helpers defined in the POST handler file (Task 4.4 Step 3), shared by DELETE handler in the same file.

**Review fixes applied (post code review, 7.5/10 → target 9/10):**
- **C1:** Strict-422 decision documented in "Design Decisions Locked by This Plan §D1".
- **C2:** Drizzle migration shape assertions (Task 3.1 Step 4) weakened to accept inline or ALTER TABLE forms.
- **C4:** Misleading "forces callers to pass undefined" rationale in Task 1.1 Step 2 corrected.
- **C5:** `vi.mock` declarations for `@/connectors/nango/connections` and `@/connectors/build-toolset` moved into Phase 4's Step 1 (alongside POST tests) so they're hoisted from the start, not first-declared in Phase 5.
- **I1:** Reconcile cron wired via Trigger.dev in the new Task 7.2.
- **I2:** New Task 8.2 "Quality gate" enforces full tsc + test + build + grep + unused-imports check before shipping.
- **I3:** POST handler catches Postgres `23505` via `isUniqueViolation` helper and returns 409 on the check-then-insert TOCTOU race. Test case added in Task 4.4 Step 1.
- **I4:** Lock-step warning added to Cross-Repo Companion Work section about shipping cowork Phase 6 before products-service webhook reconcile.
- **I5:** Task 2.2 Step 5 now audits every `getUserConnections` consumer and lists the known-safe call sites.
- **I7:** `integrationExists` in the reconcile function now rethrows on unknown error shapes (not just non-404 errors with a numeric status), preventing an SDK upgrade from silently flipping reconcile into destructive mode.
- **Gap 1 (audit log):** Structured `auditAdminCall` helper in Task 4.4 Step 3 emits `{ timestamp, ip, workspace_id, action, result, admin_user, provider_config_key, error }` on every admin endpoint call.
- **Gap 6 (credential rotation):** Documented as DELETE + POST in "Design Decisions Locked by This Plan §D2". No PATCH endpoint in V1.
- **TLS requirement:** Added as Task 8.3 Step 8 deployment checklist (manual, infra concern).

**Placeholder scan:** no TODOs, no "similar to Task N", no "handle errors appropriately". Every code block is complete.

---

## Cross-Repo Companion Work

These live outside the cowork repo. Each needs its own plan in its own repo before rollout.

### `marketmint-products-service`

- [ ] Add read-only Drizzle mirror of `shopify_apps` (`src/db/schema/shopify-apps.ts`).
- [ ] Add `getShopifyAppForWorkspace(workspaceId)` query helper with fallback to `env.NANGO_INTEGRATION_ID`.
- [ ] Update `createNangoOAuthUrl`, `getNangoAccessTokenForWorkspace`, `deleteNangoConnectionForWorkspace`, `findNangoConnection` in `src/services/nango.ts` to resolve the workspace's key.
- [ ] Add Nango `auth.created` webhook reconcile: detect duplicate Shopify connections for a workspace, keep the newest, delete the older, log both ids.
- [ ] Add the webhook route or extend the existing Nango webhook handler.

### `marketmint-ui`

- [ ] Replace hardcoded `nango.auth("shopify", ...)` with the `providerConfigKey` returned by `POST /api/cowork/connectors/connect-session`.
- [ ] Add 422 error UI ("No Shopify app provisioned for this workspace — contact support").
- [ ] Add 409 error UI ("This workspace already has Shopify connected").
- [ ] In the connections list, recognize Shopify by canonical `id === "shopify"` from `availableConnectors` (or by `providerConfigKey.startsWith("shopify-")`). Do NOT compare against the literal string `"shopify"` alone.

### Rollout Order

Follow the spec's §Rollout Order exactly:
1. products-service (fallback-only awareness) — **must include the Nango `auth.created` webhook reconcile before step 3**
2. cowork DB migration (this plan, Task 3.1)
3. cowork code (this plan, Tasks 1–8)
4. marketmint-ui
5. First provisioning via `POST /admin/shopify-apps`
6. Remaining clients

**Lock-step warnings:**

1. **Do NOT let the UI change ship before the cowork code.** The UI depends on the new `providerConfigKey` field in the connect-session response.

2. **Do NOT ship cowork Phase 6 (connect-session 409 guard) to production before the products-service `auth.created` webhook reconcile is deployed.** Cowork's 409 guard is explicitly best-effort — it catches the common case where a user clicks "Connect Shopify" while another connection is already active, but two concurrent OAuth flows started within the same session window can both pass the guard. The only thing that catches the resulting duplicate connections is the post-OAuth webhook reconcile in the products-service. Shipping cowork alone means two-concurrent-OAuth races silently create duplicate Nango connections for the same workspace, and the only cleanup is a manual operator intervention. This is an operator-visible reliability hole the team needs to close before turning on per-client Shopify apps for any real customer.

3. **Do NOT attach the Trigger.dev reconcile cron (`reconcile-shopify-apps`) before the cowork deployment lands.** The task wrapper (Task 7.2) ships with the cowork code, but attaching the 5-minute cron *before* the table and query helpers exist will crash every run. Dashboard step: after cowork deploys successfully, attach `*/5 * * * *` to the task id `reconcile-shopify-apps`.
