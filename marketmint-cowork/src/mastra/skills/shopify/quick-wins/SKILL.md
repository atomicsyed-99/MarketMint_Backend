---
name: shopify-quick-wins
description: 'Band 2 (Quick Wins) — Use when computed signals show missing SEO metadata on high-traffic products, missing image alt text, thin product descriptions, missing collection content, Klaviyo flow gaps, winback opportunities, or search term content gaps. High priority, fast to fix.'
---

# Shopify Quick Wins — Band 2 JTBD Registry

> **Prerequisite:** Load the `shopify` base skill first for pipeline context and behavioral rules.

Band 2 jobs are high-impact, low-effort fixes. The store is missing easy optimizations on pages that already get traffic.

---

## Entry 1: high_traffic_missing_seo

**"High-traffic product missing SEO metadata"** *(Spec entry #4)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Enriched at tier | 2 (with GA4 session data) |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Daily sessions x completeness gap (1.0 if both meta_title + meta_description missing, 0.5 if one) |

**Signals to check:**
- `meta_title` and `meta_description` presence (from `shopify_get_product`)
- Product daily sessions (GA4 if connected)

**Tools needed:**
- `shopify_list_products` — scan for missing SEO fields
- `shopify_get_product` — detailed check per product
- `shopify_update_product` — push generated SEO meta

**Job steps:**
1. Generate SEO meta (title + description) using product data + brand context
2. Show draft to user for approval
3. Push to Shopify via `shopify_update_product`

**Follow-ups:**
- Generate matching OG image → bridge to `creative-generation`
- Suggest internal linking from blog posts

---

## Entry 2: images_missing_alt_text

**"Product images missing alt text"** *(Spec entry #5)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Images without alt text x product daily sessions |

**Signals to check:**
- Count of product images without alt text (from `shopify_list_product_images`)

**Tools needed:**
- `shopify_list_products` — get all products
- `shopify_list_product_images` — check alt text per image
- `shopify_update_product` — update product with image alt text via product update payload

**Important:** No dedicated `shopify_update_product_image` tool exists. To update alt text on existing images, use `shopify_update_product` and include the image objects with updated `alt` fields in the product payload, e.g. `images: [{ id: 123, alt: "Red silk saree with gold border" }]`. This preserves image IDs. Alternatively, delete old image (`shopify_delete_product_image`) and re-upload with alt text (`shopify_upload_product_image`).

**Job steps:**
1. Generate descriptive alt text for each image based on product context
2. Show batch to user for approval
3. Push to Shopify via `shopify_update_product` with image alt fields

**Follow-ups:**
- Audit overall accessibility completeness

---

## Entry 3: pdp_content_incomplete

**"Product description incomplete or too thin"** *(Spec entry #6)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | (1 - completeness score) x product daily sessions |

**Signals to check:**
- `body_html` word count (from `shopify_get_product`)
- Content completeness score (derive from: title quality, description length, image count, alt text, SEO meta)

**Tools needed:**
- `shopify_get_product` — current content
- `shopify_update_product` — push rewrite

**Job steps:**
1. Generate PDP rewrite using product data, images, brand voice → bridge to `copywriting` for rich descriptions
2. Show draft to user
3. Push to Shopify via `shopify_update_product`

**Follow-ups:**
- Generate matching SEO meta (if not already done)
- Set up A/B test vs current description

---

## Entry 4: collection_missing_content

**"Collection page missing description or SEO"** *(Spec entry #8)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Collection daily sessions x completeness gap |

**Signals to check:**
- Collection description presence and length (from `shopify_list_collections`)
- Collection daily sessions (GA4 if connected)

**Tools needed:**
- `shopify_list_collections` + `shopify_list_smart_collections` — find gaps
- `shopify_update_collection` — push content

**Job steps:**
1. Generate collection description
2. Generate collection SEO meta
3. Suggest product ordering by CVR (if GA4 connected)
4. Push to Shopify via `shopify_update_collection`

**Follow-ups:**
- Generate blog post linking to collection → bridge to `copywriting`

---

## Entry 5: klaviyo_flow_gap

**"Churned customers missing lifecycle education flow"** *(Spec entry #14)*

| Field | Value |
|-------|-------|
| Requires | Klaviyo |
| Fires at tier | 3 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Churned users without flow x avg LTV |

**Signals to check:**
- % of churned users with zero flow opens (Klaviyo)
- Whether education flow exists (Klaviyo)

**Tools needed:**
- Klaviyo tools — flow list, profile engagement data
- `shopify_list_customers` — customer data cross-reference

**Job steps:**
1. Identify missing flows
2. Draft education email sequence content → bridge to `copywriting`
3. Surface for Klaviyo deployment (user deploys in Klaviyo)

**Follow-ups:**
- Monitor open rate on new flow
- Measure month-2 retention for affected cohort

---

## Entry 6: winback_opportunity

**"Lapsed customer segment eligible for winback"** *(Spec entry #15)*

| Field | Value |
|-------|-------|
| Requires | Klaviyo + Shopify |
| Fires at tier | 3 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Lapsed customer count x (avg order value x estimated winback rate, default 8%) |

**Signals to check:**
- Customers with no order in 60-90 days (Shopify)
- Whether winback flow is active (Klaviyo)

**Tools needed:**
- `shopify_list_customers` + `shopify_list_orders` — identify lapsed segment
- Klaviyo tools — check existing flows

**Job steps:**
1. Size lapsed segment
2. Draft winback email sequence → bridge to `copywriting`
3. Surface for Klaviyo deployment

**Follow-ups:**
- Monitor winback revenue
- A/B test offer vs no-offer

---

## Entry 7: search_term_content_gap

**"High-volume search terms with no matching store content"** *(Spec entry #16)*

| Field | Value |
|-------|-------|
| Requires | Google Ads |
| Fires at tier | 2 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Monthly impressions x (1 - impression share) |

**Signals to check:**
- Search terms with meaningful impression volume but no matching product/collection page

**Tools needed:**
- Google Ads tools — search terms report
- `shopify_list_products` — match against existing catalog
- `shopify_list_collections` — match against collections
- `shopify_create_page` or `shopify_create_collection` — create matching content

**Job steps:**
1. Extract unmatched search terms
2. Match to existing catalog
3. Generate blog post or collection for gaps → bridge to `copywriting`
4. Generate SEO meta
5. Push to Shopify

**Follow-ups:**
- Suggest Google Ads campaign for new content
- Add internal links from existing blog
