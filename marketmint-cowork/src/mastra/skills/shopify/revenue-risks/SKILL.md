---
name: shopify-revenue-risks
description: 'Band 1 (Revenue at Risk) — Use when computed signals show active ad spend with poor conversion, impending stockouts, CVR anomalies, high CAC cohorts, checkout friction, mobile conversion regression, or refund spikes. Highest priority band.'
---

# Shopify Revenue Risks — Band 1 JTBD Registry

> **Prerequisite:** Load the `shopify` base skill first for pipeline context and behavioral rules.

These are the highest-priority jobs. Band 1 fires when revenue is actively at risk — the store is spending money or losing sales right now.

---

## Entry 1: active_spend_low_cvr

**"Ad spend active, product not converting"** *(Spec entry #1)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 (Shopify only — less specific) |
| Enriched at tier | 2 (with GA4/Ads — full picture) |
| Autonomy | 0 — Alert only |
| Priority logic | Higher ad spend x larger CVR gap from benchmark = higher urgency |

**Signals to check:**
- Product CVR vs store average CVR (derive from GA4 sessions + Shopify orders)
- Daily ad spend on this product (from Meta Ads or Google Ads connector)

**Tools needed:**
- `shopify_list_orders` — orders for this product (last 30d)
- `shopify_get_product` — product details
- GA4 tools (if connected) — sessions by product page
- Meta/Google Ads tools (if connected) — spend by product

**Job steps:**
1. Diagnose the PDP — what's wrong with the product page?
2. Generate PDP rewrite using product data + brand context
3. Push to Shopify via `shopify_update_product` (after user confirms)
4. Suggest A/B test setup

**Follow-ups after completion:**
- Monitor test results (suggest checking back in 7 days)
- Apply fix to similar SKUs if the rewrite improves CVR

---

## Entry 2: stockout_while_spending

**"Inventory running out while ads are live"** *(Spec entry #2)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Enriched at tier | 2 |
| Autonomy | 0 — Alert only |
| Priority logic | Higher spend / fewer days remaining = higher urgency |

**Signals to check:**
- Inventory days remaining: `current_stock / (orders_last_30d / 30)`
- Daily ad spend active on this product

**Tools needed:**
- `shopify_get_inventory_levels` — current stock (requires inventory_item_ids from product variants)
- `shopify_list_orders` — last 30d orders for velocity
- Meta/Google Ads tools — active spend (if connected)

**Job steps:**
1. Alert stockout risk with days remaining + daily spend
2. Suggest pausing ads (via ad connector if available)
3. Suggest reorder (inform user of timeline)
4. Draft back-in-stock flow (if Klaviyo connected)

**Follow-ups:**
- Relaunch ads on restock
- Draft scarcity messaging if low stock is intentional

---

## Entry 3: cvr_drop_anomaly

**"Store-wide CVR drop vs baseline"** *(Spec entry #3)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Enriched at tier | 2 |
| Autonomy | 0 — Alert only |
| Priority logic | Store daily revenue x magnitude of CVR drop from baseline |

**Signals to check:**
- Current store CVR vs 7-day average (GA4 + Shopify)
- Checkout completion rate change

**Tools needed:**
- `shopify_list_orders` — recent order volume
- GA4 tools — session data, checkout events
- `shopify_list_themes` — check for recent theme changes

**Job steps:**
1. Diagnose CVR drop — check for correlating changes
2. Flag possible incident (broken checkout, payment issue)
3. Surface recent theme changes via `shopify_list_themes`
4. Generate diagnostic brief

**Follow-ups:**
- Suggest reverting recent theme change if correlated
- Check payment method status

---

## Entry 4: high_cac_low_ltv_cohort

**"Recent acquisition cohort showing low LTV trajectory"** *(Spec entry #11)*

| Field | Value |
|-------|-------|
| Requires | Klaviyo + Meta Ads or Google Ads |
| Fires at tier | 3 |
| Autonomy | 0 — Alert only |
| Priority logic | Cohort size x (store avg LTV - cohort projected LTV) |

**Signals to check:**
- Month-2 retention rate for recent cohort vs store average (Klaviyo + Shopify)
- CAC for that cohort vs store average (ad connector)

**Tools needed:**
- Klaviyo tools — cohort retention data
- `shopify_list_orders` + `shopify_list_customers` — purchase history
- Meta/Google Ads tools — acquisition cost

**Job steps:**
1. Diagnose cohort quality
2. Segment high-risk cohort
3. Draft education email flow
4. Adjust acquisition targeting suggestion

**Follow-ups:**
- Monitor month-3 retention
- Run winback if churn confirmed

---

## Entry 5: checkout_friction_detected

**"Checkout funnel drop-off above baseline"** *(Spec entry #12)*

| Field | Value |
|-------|-------|
| Requires | GA4 |
| Fires at tier | 2 |
| Autonomy | 0 — Alert only |
| Priority logic | Store daily revenue x magnitude of checkout rate drop |

**Signals to check:**
- Checkout-to-purchase rate vs baseline (GA4)
- Cart-to-checkout rate vs baseline (GA4)

**Tools needed:**
- GA4 tools — funnel events (add_to_cart, begin_checkout, purchase)
- `shopify_list_orders` — order volume for cross-reference

**Job steps:**
1. Identify drop-off step in funnel
2. Check for payment method errors
3. Check for shipping rate changes
4. Surface diagnostic brief

**Follow-ups:**
- Generate cart abandonment flow (if Klaviyo connected)
- Flag for theme rollback if correlated

---

## Entry 6: mobile_cvr_regression

**"Mobile CVR significantly below desktop"** *(Spec entry #13)*

| Field | Value |
|-------|-------|
| Requires | GA4 |
| Fires at tier | 2 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Mobile sessions x (desktop CVR - mobile CVR) x avg order value |

**Signals to check:**
- Mobile CVR vs desktop CVR (GA4)
- Mobile bounce rate (GA4)

**Tools needed:**
- GA4 tools — device-segmented sessions + conversions
- `shopify_list_products` — identify high-traffic mobile PDPs
- `shopify_get_product` — current content

**Job steps:**
1. Identify high-traffic mobile PDPs
2. Diagnose mobile content issues (image size, description length)
3. Generate mobile-optimized description
4. Push to Shopify via `shopify_update_product` (after confirm)

**Follow-ups:**
- Generate mobile hero image crop
- Setup A/B test: mobile vs desktop copy

---

## Entry 7: refund_spike_detected

**"Refund rate spiking above baseline"** *(Verification UC-C4)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 0 — Alert only |
| Priority logic | Refund count increase x avg refund value x store daily revenue share |

**Signals to check:**
- Refund rate last 7 days vs 30-day baseline (from `shopify_list_orders` with financial_status=refunded)
- Whether refunds are concentrated in 1-2 SKUs or spread across catalog
- Whether refunding customers share a UTM source (if GA4 connected)

**Tools needed:**
- `shopify_list_orders` (financial_status=refunded) — refund volume and SKU breakdown
- `shopify_list_orders` (financial_status=paid) — baseline for rate calculation
- `shopify_get_product` — content comparison: refunded SKUs vs non-refunded

**Job steps:**
1. Isolate which SKUs and channels are driving the refund increase
2. Compare refunded SKUs' content against non-refunded SKUs (image quality, description accuracy)
3. Separate content causes (expectation mismatch) from ops causes (fulfilment, quality)
4. If content-driven: generate realistic product imagery and accurate description
5. If ops-driven: surface escalation brief for the operator's team

**Follow-ups:**
- Generate clarifying product video (unboxing/usage) to set accurate expectations → bridge to `creative-video-generation`
- Generate size guide or spec infographic if returns are driven by missing information → bridge to `creative-generation`

**Artifact types:** reasoning (root cause report), image (realistic product shots), video (unboxing/usage), text (rewritten description)
