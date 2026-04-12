# Shopify Multi-App Registry — Frontend Spec

## Context

The cowork backend now supports per-workspace Shopify custom app provisioning. Instead of a single shared Shopify app (which Shopify hasn't approved for production), each workspace registers their own custom Shopify app credentials. The backend handles credential validation, Nango integration creation, and dynamic routing of all Shopify API calls through the workspace's specific app.

This spec describes the frontend changes needed in `marketmint-ui` to let users set up their Shopify connection through a self-service flow.

## Backend API Reference

All endpoints are Clerk-authenticated. Base path: `/api/cowork/connectors`.

### GET /connectors/shopify-app

Returns the workspace's current Shopify app status and the list of required scopes.

**Response (no app provisioned):**
```json
{
  "app": null,
  "required_scopes": [
    "read_products", "write_products", "read_orders", "write_orders",
    "read_draft_orders", "write_draft_orders", "read_customers",
    "write_customers", "read_inventory", "write_inventory",
    "read_product_listings", "read_collections", "write_collections",
    "read_price_rules", "write_price_rules", "read_discounts",
    "write_discounts", "read_gift_cards", "write_gift_cards",
    "read_themes", "read_content", "write_content"
  ]
}
```

**Response (app provisioned):**
```json
{
  "app": {
    "provider_config_key": "shopify-acme-7f3a2b",
    "app_name": "acme",
    "store_domain": "acme.myshopify.com",
    "status": "active",
    "client_id_last4": "1234",
    "scopes": ["read_products", "write_products", "..."],
    "created_at": "2026-04-10T12:00:00Z"
  },
  "required_scopes": ["read_products", "write_products", "..."]
}
```

**Possible `status` values:** `"pending"`, `"active"`, `"failed"`

### POST /connectors/shopify-app

Provisions a new Shopify app for the workspace.

**Request body:**
```json
{
  "client_id": "abcdef1234567890",
  "client_secret": "shpss_...",
  "store_domain": "acme.myshopify.com"
}
```

**Success response (200):**
```json
{
  "provider_config_key": "shopify-acme-7f3a2b",
  "app_name": "acme",
  "store_domain": "acme.myshopify.com",
  "status": "active"
}
```

**Error responses:**

| Status | When | `error` field |
|--------|------|---------------|
| 400 | Invalid body or Shopify credential validation failed | Zod issues or `"Invalid client_id or client_secret"` / `"Store not found: ..."` |
| 409 | Workspace already has an app (active or pending) | `"This workspace already has a Shopify app configured"` |
| 502 | Nango integration creation failed after validation passed | `"Failed to create Shopify integration"` |

### DELETE /connectors/shopify-app

Tears down the workspace's Shopify app and all its connections.

**Success response (200):**
```json
{ "success": true, "deleted_connections": 1 }
```

**Error responses:**

| Status | When | `error` field |
|--------|------|---------------|
| 404 | No active app | `"No active Shopify app for this workspace"` |
| 409 | App not in active state (concurrent delete) | `"App is not in an active state"` |
| 202 | Partial teardown (Nango unreachable) — reconcile will retry | `"Teardown incomplete; will retry automatically"` |

### POST /connectors/connect-session (existing, modified)

When `integrationId: "shopify"` is passed, the backend now:
- Looks up the workspace's provisioned app
- Returns `422` if no app provisioned: `"No Shopify app provisioned for this workspace. Contact support."`
- Returns `409` if already connected: `"This workspace already has Shopify connected. Disconnect first or use a separate workspace."`
- On success, returns `{ sessionToken, providerConfigKey }` — the `providerConfigKey` is the per-workspace key

---

## User Flow

### State Machine

```
[No App] → (user fills form + submits) → [Provisioning...] → [App Active] → (user clicks Connect) → [OAuth Flow] → [Connected]
                                              ↓ failure
                                         [App Failed] → (user retries) → [Provisioning...]

[Connected] → (user disconnects Shopify) → [App Active, No Connection]
[App Active] → (user removes app) → [No App]
```

### Step-by-Step

#### 1. User navigates to Connectors / Integrations page

Frontend calls `GET /connectors/shopify-app` on page load.

- **If `app` is `null`:** Show the Shopify setup card in "not configured" state with a "Set Up Shopify" button.
- **If `app.status === "active"`:** Show the configured state with store domain, last 4 of client_id, and either a "Connect" button (if no active Shopify connection) or "Connected" status (if already connected via `GET /connectors/connections`).
- **If `app.status === "pending"`:** Show a loading/spinner state — "Setting up your Shopify app..."
- **If `app.status === "failed"`:** Show an error state with "Setup failed. Please try again." and a retry button.

#### 2. User clicks "Set Up Shopify" → Setup Modal/Drawer opens

The setup flow is a **two-step form**:

**Step 1: Instructions + Scope Checklist**

Display a clear instruction block:

> To connect your Shopify store, you need to create a **Custom App** in your Shopify admin panel.
>
> 1. Go to **Settings → Apps and sales channels → Develop apps** in your Shopify admin
> 2. Click **Create an app** and name it (e.g. "MarketMint Integration")
> 3. Go to **Configuration → Admin API integration** and add **all** the scopes listed below
> 4. Click **Install app** to generate your API credentials
> 5. Copy the **API key** (client_id) and **API secret key** (client_secret)

Below this, render the `required_scopes` array from the GET response as a checklist:

```
Required Shopify Scopes (must add ALL of these):

  Products      ✓ read_products    ✓ write_products
  Orders        ✓ read_orders      ✓ write_orders
  Draft Orders  ✓ read_draft_orders ✓ write_draft_orders
  Customers     ✓ read_customers   ✓ write_customers
  Inventory     ✓ read_inventory   ✓ write_inventory
  Collections   ✓ read_collections ✓ write_collections
  Discounts     ✓ read_price_rules ✓ write_price_rules
                ✓ read_discounts   ✓ write_discounts
  Gift Cards    ✓ read_gift_cards  ✓ write_gift_cards
  Themes        ✓ read_themes
  Content       ✓ read_content     ✓ write_content
  Listings      ✓ read_product_listings
```

Show a warning banner:

> **Important:** If any scopes are missing, the related MarketMint features (e.g. order management, inventory tracking) will not work. Make sure to add all scopes listed above.

Add a checkbox: "I have added all the required scopes to my Shopify app"

"Next" button is disabled until the checkbox is checked.

**Step 2: Credentials Form**

Three fields:

| Field | Label | Placeholder | Validation |
|-------|-------|-------------|------------|
| `store_domain` | Store Domain | `your-store.myshopify.com` | Required. Must end with `.myshopify.com`. Show inline error if not. |
| `client_id` | API Key (Client ID) | Paste from Shopify app settings | Required. Non-empty string. |
| `client_secret` | API Secret Key (Client Secret) | Paste from Shopify app settings | Required. Non-empty string. |

- `client_secret` field should be a password-type input with a show/hide toggle
- "Connect Shopify" button at the bottom

#### 3. User submits the form

1. Disable the submit button, show a loading spinner with text "Validating credentials..."
2. Call `POST /connectors/shopify-app` with `{ client_id, client_secret, store_domain }`
3. **On 200:** Close the modal. Show a success toast: "Shopify app configured! Click Connect to authorize." The Shopify card now shows the "active" state.
4. **On 400:** Show the error message inline under the form. Common errors:
   - `"Invalid client_id or client_secret"` — highlight both credential fields
   - `"Store not found: ..."` — highlight store_domain field
   - Zod validation errors — highlight the relevant fields
5. **On 409:** Show "This workspace already has a Shopify app configured." with a link to the existing app status.
6. **On 502:** Show "Failed to set up Shopify integration. Please try again." with a retry button.

#### 4. User clicks "Connect" on the active Shopify card

This triggers the existing Nango OAuth flow:

1. Call `POST /connectors/connect-session` with `{ integrationId: "shopify" }`
2. The backend resolves the workspace's `providerConfigKey` and returns `{ sessionToken, providerConfigKey }`
3. Use the Nango frontend SDK: `nango.auth(providerConfigKey, { connectSessionToken: sessionToken })`
4. On OAuth success → Shopify is now connected, tools are available in chat

**Handle errors:**
- `422` ("No Shopify app provisioned") — should not happen if the card shows "active", but handle defensively. Show "Please set up your Shopify app first."
- `409` ("Already connected") — show "Shopify is already connected. Disconnect first if you want to reconnect."

#### 5. User disconnects Shopify

Uses the existing `DELETE /connectors/disconnect` flow (unchanged). After disconnecting:
- The Shopify card goes back to "App Active, not connected" state
- User can reconnect via the same Connect button (re-runs OAuth)

#### 6. User removes the Shopify app entirely

Accessible via a "Remove Shopify App" button (in the app status section or a settings menu). This is a destructive action:

1. Show a confirmation dialog: "This will disconnect your Shopify store and remove the app configuration. You'll need to set up the connection again. Are you sure?"
2. On confirm → call `DELETE /connectors/shopify-app`
3. **On 200:** Reset to "No App" state. Show toast: "Shopify app removed."
4. **On 202:** Show toast: "Removal in progress. This may take a few minutes." Poll `GET /connectors/shopify-app` until `app` is `null`.

---

## UI States Summary

### Shopify Card on Connectors Page

| State | Visual | Primary Action | Secondary Action |
|-------|--------|----------------|------------------|
| No App | Shopify logo + "Not configured" | "Set Up Shopify" button | — |
| Pending | Shopify logo + spinner + "Setting up..." | — (disabled) | — |
| Failed | Shopify logo + error icon + "Setup failed" | "Try Again" button | — |
| Active, not connected | Shopify logo + store domain + "Ready" | "Connect" button | "Remove App" (menu/link) |
| Active, connected | Shopify logo + store domain + green "Connected" | "Disconnect" button | "Remove App" (menu/link) |

### Differentiation from Other Connectors

Shopify is the only connector that requires a two-phase setup (provision app, then OAuth connect). All other connectors (Meta Ads, Google Ads, etc.) go directly to OAuth via `connect-session`. The frontend should:

- Detect Shopify specially in the connectors list
- Check `GET /connectors/shopify-app` to determine which state to show
- Route through the setup flow before allowing the OAuth connect

One way to implement: when the user clicks "Connect" on a Shopify connector card and `app` is `null`, show the setup modal first instead of starting the OAuth flow.

---

## Data Flow Diagram

```
Frontend                              Backend (cowork)                    Nango / Shopify
   │                                       │                                   │
   ├─ GET /connectors/shopify-app ────────>│                                   │
   │<── { app: null, required_scopes } ────│                                   │
   │                                       │                                   │
   │  (user fills credentials form)        │                                   │
   │                                       │                                   │
   ├─ POST /connectors/shopify-app ───────>│                                   │
   │                                       ├─ validate creds ─────────────────>│
   │                                       │<── 200 OK ───────────────────────│
   │                                       ├─ INSERT pending row (DB)          │
   │                                       ├─ nango.createIntegration ────────>│
   │                                       │<── integration created ──────────│
   │                                       ├─ UPDATE → active (DB)             │
   │<── { status: "active", ... } ─────────│                                   │
   │                                       │                                   │
   │  (user clicks Connect)                │                                   │
   │                                       │                                   │
   ├─ POST /connectors/connect-session ───>│                                   │
   │  { integrationId: "shopify" }         ├─ lookup workspace app (DB)        │
   │                                       ├─ nango.createConnectSession ─────>│
   │<── { sessionToken, providerConfigKey }│<── session created ──────────────│
   │                                       │                                   │
   ├─ nango.auth(providerConfigKey, ──────────────────────────────────────────>│
   │    { connectSessionToken })           │                          (OAuth redirect to Shopify)
   │<── OAuth callback success ──────────────────────────────────────────────<│
   │                                       │                                   │
   │  (Shopify connected! tools available) │                                   │
```

---

## Error Handling Patterns

### Network errors

All API calls should have a try/catch with a generic fallback toast: "Something went wrong. Please try again."

### Polling for pending state

If `GET /connectors/shopify-app` returns `status: "pending"`, the frontend should:
- Show a spinner on the Shopify card
- Poll every 3 seconds (max 10 attempts)
- If it transitions to `"active"` → update UI
- If it transitions to `"failed"` → show error state
- If still pending after 30s → show "This is taking longer than expected. Please refresh."

This covers the edge case where the user refreshes the page while provisioning is in-flight.

### Stale 409 on connect-session

If the user sees a "Connected" state but `POST /connectors/connect-session` returns 409, the connections cache may be stale. Call `GET /connectors/connections` to refresh, then update the UI.

---

## Scopes Display Component

The `required_scopes` array should be rendered as a grouped checklist. Suggested grouping:

```typescript
const SCOPE_GROUPS = [
  { label: "Products", scopes: ["read_products", "write_products", "read_product_listings"] },
  { label: "Orders", scopes: ["read_orders", "write_orders"] },
  { label: "Draft Orders", scopes: ["read_draft_orders", "write_draft_orders"] },
  { label: "Customers", scopes: ["read_customers", "write_customers"] },
  { label: "Inventory", scopes: ["read_inventory", "write_inventory"] },
  { label: "Collections", scopes: ["read_collections", "write_collections"] },
  { label: "Discounts", scopes: ["read_price_rules", "write_price_rules", "read_discounts", "write_discounts"] },
  { label: "Gift Cards", scopes: ["read_gift_cards", "write_gift_cards"] },
  { label: "Themes", scopes: ["read_themes"] },
  { label: "Content (Pages)", scopes: ["read_content", "write_content"] },
];
```

Display as a two-column grid of scope pills/badges grouped by category. This is informational only — the user cannot select/deselect scopes. The purpose is to make it easy for the user to verify they've added all scopes in their Shopify app settings.

---

## Implementation Notes

- The `providerConfigKey` returned from `POST /connectors/shopify-app` is NOT needed by the frontend for the OAuth flow — the backend resolves it automatically when `connect-session` is called with `integrationId: "shopify"`. The frontend only needs it for display purposes (or can ignore it).
- The `client_secret` should never be stored client-side after form submission. It is sent to the backend once and never returned in any GET response.
- The `client_id_last4` field in the GET response can be shown as "API Key ending in ****1234" for identification without exposing the full key.
- The existing `GET /connectors/connections` response continues to work — Shopify connections show up under the canonical `"shopify"` key regardless of the per-workspace provider config key.
