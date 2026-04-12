---
name: shopify-maintenance
description: 'Band 4 (Maintenance & Planning) — Use when computed signals show products stuck in draft for 14+ days, stale descriptions, new product launches needing content packages, or seasonal content refresh needed. Lowest priority band, routine upkeep and forward planning.'
---

# Shopify Maintenance — Band 4 JTBD Registry

> **Prerequisite:** Load the `shopify` base skill first for pipeline context and behavioral rules.

Band 4 jobs are routine maintenance and forward planning. Not urgent, but they accumulate technical and content debt if ignored.

---

## Entry 1: products_stuck_in_draft

**"Products in draft state for 14+ days"** *(Spec entry #9)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 0 — Alert only |
| Priority logic | Draft count x estimated revenue per SKU (store avg revenue per active SKU) |

**Signals to check:**
- Products with `status = draft` and days in draft > 14 (from `shopify_list_products`)

**Tools needed:**
- `shopify_list_products` with `status=draft` — find stuck drafts
- `shopify_get_product` — check what's missing
- `shopify_update_product` — fill in content
- `shopify_publish_products` — batch publish (pass product IDs array)

**Job steps:**
1. Surface draft products list with how long each has been in draft
2. Generate missing content for each draft (description, SEO meta, images)
3. Push content and publish via `shopify_update_product` + `shopify_publish_products`

**Follow-ups:**
- Add published products to relevant collections via `shopify_add_product_to_collection`
- Suggest inclusion in next campaign

---

## Entry 2: stale_product_descriptions

**"Active product with description not updated in 90+ days"** *(Spec entry #10)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Days stale x product revenue share (% of total store revenue last 90 days) |

**Signals to check:**
- Description last updated timestamp (from `shopify_get_product` — `updated_at`)
- Product status = active with orders in last 30 days

**Tools needed:**
- `shopify_list_products` — find active products
- `shopify_list_orders` — identify products with recent sales
- `shopify_get_product` — check `updated_at` timestamps
- `shopify_update_product` — push refreshed content

**Job steps:**
1. Flag products for refresh review (show staleness + revenue share)
2. Generate refreshed description → bridge to `copywriting` for rich content
3. Push to Shopify via `shopify_update_product` (after confirm)

**Follow-ups:**
- Generate matching SEO meta refresh
- Suggest seasonal creative refresh → bridge to `creative-generation`

---

## Entry 3: new_product_launch_setup

**"New product needs full content package before launch"** *(Verification UC-B2)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Launch urgency (days until target date) x estimated revenue per SKU |

**Signals to check:**
- Products with status=draft and recent creation date (from `shopify_list_products`)
- Whether comparable products exist in the same category for benchmarking
- Content completeness of the draft product

**Tools needed:**
- `shopify_list_products` — find draft products and comparable active products
- `shopify_get_product` — detailed content of draft and benchmarks
- `shopify_update_product` — push generated content
- `shopify_publish_products` — publish when ready
- `shopify_add_product_to_collection` — add to relevant collections

**Job steps:**
1. Look at top-performing PDPs in the same category on the store
2. Extract content patterns that correlate with strong launch velocity (image style, title formula, description structure)
3. Generate full content package: title variants, long-form + short-form description, SEO meta
4. Push to Shopify via `shopify_update_product` (after confirm)
5. Generate hero images (3 variants: lifestyle, studio, contextual) → bridge to `creative-generation` with product image as `asset_urls`
6. Generate launch video → bridge to `creative-video-generation`
7. Set 14-day velocity benchmark note for follow-up

**Follow-ups:**
- Generate launch email banner → bridge to `creative-generation`
- Generate ad creative for paid social → bridge to `creative-generation`
- Schedule post-launch review at 14 days (check velocity vs comparable launches using `shopify_list_orders`)

**Artifact types:** reasoning (launch brief), image (hero images, email banner, ad creative), video (launch video), text (title, description, SEO meta)

---

## Entry 4: seasonal_content_refresh

**"Seasonal content production for upcoming event/holiday"** *(Verification UC-B9 / J12)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Days until seasonal window x revenue potential (historical seasonal revenue if available) |

**Signals to check:**
- Top-performing products from comparable seasonal windows in historical orders (from `shopify_list_orders`)
- Current product content — does it already have seasonal theming?
- Collection pages for seasonal groupings

**Tools needed:**
- `shopify_list_orders` — historical orders for seasonal window analysis
- `shopify_list_products` — identify top seasonal SKUs
- `shopify_get_product` — current content check
- `shopify_update_product` — push seasonal content
- `shopify_create_collection` / `shopify_update_collection` — seasonal collection

**Job steps:**
1. Identify top-performing products for the relevant seasonal window from historical orders
2. Check if seasonal collection exists; create or update if needed
3. Generate seasonal content: themed hero images, seasonal title/description variants
4. Push seasonal copy to Shopify via `shopify_update_product` (after confirm)
5. Generate seasonal hero images and ad creative → bridge to `creative-generation`
6. Generate seasonal video reels → bridge to `creative-video-generation`

**Follow-ups:**
- Generate seasonal email banner → bridge to `creative-generation`
- Generate seasonal ad creative across formats → bridge to `creative-generation`
- Generate collection page banner → bridge to `creative-generation`
- Schedule post-season content revert

**Artifact types:** reasoning (seasonal SKU priority brief), image (seasonal hero, email banner, ad creative, collection banner), video (seasonal reels), text (seasonal title + description variants)
