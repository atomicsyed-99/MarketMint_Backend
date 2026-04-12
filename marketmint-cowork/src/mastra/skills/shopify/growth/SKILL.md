---
name: shopify-growth
description: 'Band 3 (Growth) — Use when computed signals show ad creative fatigue, top-performing creatives with no variants, revenue concentration in few SKUs, contribution margin compression, CAC above break-even, post-promo analysis needed, bundle/cross-sell gaps, or price-content misalignment. Medium priority, strategic impact.'
---

# Shopify Growth — Band 3 JTBD Registry

> **Prerequisite:** Load the `shopify` base skill first for pipeline context and behavioral rules.

Band 3 jobs are strategic growth opportunities. The store isn't losing money right now, but there are untapped gains or emerging risks.

---

## Entry 1: creative_fatigue_detected

**"Ad creative showing fatigue signals"** *(Spec entry #7)*

| Field | Value |
|-------|-------|
| Requires | Meta Ads or Google Ads |
| Fires at tier | 2 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Daily ad spend x (1 - current CTR / baseline CTR) |

**Signals to check:**
- 7-day avg CTR vs 30-day avg CTR for active creatives
- Ad frequency (Meta) — high frequency accelerates fatigue

**Tools needed:**
- Meta/Google Ads tools — creative performance, CTR trends
- `shopify_get_product` — product data for new creative generation

**Job steps:**
1. Diagnose which creatives are fatigued (CTR declining)
2. Generate new hero image using product data → bridge to `creative-generation`
3. Generate new ad copy variants → bridge to `copywriting`
4. Push creative to Shopify as product images via `shopify_upload_product_image`
5. Suggest push to ad platform (user executes in ad manager)

**Follow-ups:**
- Setup A/B test: new vs current creative
- Monitor CTR after refresh

---

## Entry 2: top_performing_creative_to_replicate

**"Top-performing ad creative with no follow-on variants"** *(Spec entry #17)*

| Field | Value |
|-------|-------|
| Requires | Meta Ads or Google Ads |
| Fires at tier | 2 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Winning creative spend x (creative CTR / ad set avg CTR) |

**Signals to check:**
- Creative CTR vs ad set average CTR
- Number of variants currently running for that creative

**Tools needed:**
- Meta/Google Ads tools — creative-level performance
- `shopify_get_product` — product data for variant generation

**Job steps:**
1. Analyze winning creative attributes (what's working)
2. Generate 3 variants in the same direction → bridge to `creative-generation`
3. Push to Shopify as product images via `shopify_upload_product_image`
4. Suggest push to ad platform

**Follow-ups:**
- Setup creative A/B test
- Monitor CTR on new variants

---

## Entry 3: revenue_concentration_risk

**"Revenue overly concentrated in one or two SKUs"** *(Spec entry #18)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 0 — Alert only |
| Priority logic | Top SKU revenue share x store daily revenue |

**Signals to check:**
- Revenue share of top 2 SKUs (from `shopify_list_orders` last 90d)
- Inventory days remaining for top SKU

**Tools needed:**
- `shopify_list_orders` — last 90 days, aggregate by SKU
- `shopify_get_inventory_levels` — top SKU stock (requires inventory_item_ids from variants)
- `shopify_list_products` — identify underinvested secondary SKUs

**Job steps:**
1. Surface concentration analysis with specific numbers
2. Identify underinvested secondary SKUs
3. Generate improved content for secondary SKUs → bridge to `creative-generation` + `copywriting`
4. Suggest collection reorder by revenue via `shopify_update_collection`

**Follow-ups:**
- Suggest bundle strategy with top SKU
- Draft email campaign featuring secondary SKUs (if Klaviyo connected)

---

## Entry 4: contribution_margin_compression

**"Contribution margin declining week-over-week"** *(Spec entry #19)*

| Field | Value |
|-------|-------|
| Requires | Meta/Google Ads + GA4 |
| Fires at tier | 2 |
| Autonomy | 0 — Alert only |
| Priority logic | Store daily revenue x (baseline margin - current margin) |

**Signals to check:**
- 7-day contribution margin vs 30-day average: `margin = revenue - COGS - ad_spend - fees`
- CPC trend: 7-day vs 30-day average

**Tools needed:**
- `shopify_list_orders` — revenue data
- `shopify_get_inventory_item` — COGS (cost field)
- Meta/Google Ads tools — ad spend, CPC trends

**Job steps:**
1. Compute contribution margin breakdown (show all components)
2. Identify compression driver (rising CPC? falling AOV? increased returns?)
3. Generate financial brief
4. Surface safe spend ceiling

**Follow-ups:**
- Suggest price adjustment if margin warrants (autonomy 0 — confirm first)
- Flag discount codes eroding margin via `shopify_list_price_rules`

---

## Entry 5: cac_above_break_even

**"Customer acquisition cost above break-even threshold"** *(Spec entry #20)*

| Field | Value |
|-------|-------|
| Requires | Meta/Google Ads + Shopify |
| Fires at tier | 2 |
| Autonomy | 0 — Alert only |
| Priority logic | (Channel CAC - break-even CAC) x new customers per day |

**Signals to check:**
- Channel CAC: `spend / new_customers_acquired`
- Break-even CAC: `AOV x gross_margin_%`
- 7-day CAC trend direction

**Tools needed:**
- Meta/Google Ads tools — spend data
- `shopify_list_orders` + `shopify_list_customers` — new customer orders
- `shopify_get_inventory_item` — for margin calculation

**Job steps:**
1. Compute break-even CAC
2. Compute channel CAC
3. Generate financial risk brief
4. Recommend spend pause or reduction

**Follow-ups:**
- Suggest retention focus over acquisition
- Run what-if on price increase

---

## Entry 6: promo_debrief

**"Post-promotion performance analysis"** *(Verification UC-C1)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 0 — Alert only |
| Priority logic | Promo revenue x (1 - incrementality ratio) — higher waste = higher urgency |

**Signals to check:**
- Revenue velocity during promo window vs 30-day baseline (from `shopify_list_orders`)
- Post-promo velocity drop (demand pull-forward signal)
- New vs returning customer mix during promo (from `shopify_list_customers` cross-ref)
- Which SKUs benefited vs which dragged down AOV

**Tools needed:**
- `shopify_list_orders` — promo window orders vs baseline
- `shopify_list_customers` — new vs returning breakdown
- `shopify_list_price_rules` — active/expired discount codes
- `shopify_get_product` — per-SKU promo performance

**Job steps:**
1. Compare promo revenue velocity vs baseline
2. Check post-promo velocity for pull-forward signal
3. Break down new vs returning mix during promo
4. Identify which SKUs benefited and which dragged AOV
5. Produce verdict: incremental, pull-forward, or unclear
6. Generate next promo brief with recommended structure and timing

**Follow-ups:**
- Generate promo creative for next window → bridge to `creative-generation`
- Draft promo email sequence → bridge to `copywriting`

**Artifact types:** reasoning (debrief report, next promo brief), image (promo creative), text (email copy)

---

## Entry 7: bundle_crosssell_gaps

**"Missing bundle and cross-sell opportunities"** *(Verification J10)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Frequently co-purchased product pairs without a bundle x combined revenue |

**Signals to check:**
- Products frequently ordered together (from `shopify_list_orders` — multi-item order analysis)
- Whether a bundle product already exists for frequent pairs
- Revenue concentration in single-item orders vs potential lift from bundling

**Tools needed:**
- `shopify_list_orders` — multi-item orders to find co-purchase patterns
- `shopify_list_products` — check if bundle products exist
- `shopify_create_product` — create bundle product (after confirm)
- `shopify_list_collections` — check for bundle/set collections

**Job steps:**
1. Analyze multi-item orders for co-purchase frequency
2. Identify top 3-5 product pairs bought together most often
3. Check if bundle products already exist for these pairs
4. For missing bundles: generate bundle product (title, description, image)
5. Create bundle via `shopify_create_product` (after confirm)

**Follow-ups:**
- Add bundle to relevant collection via `shopify_add_product_to_collection`
- Generate bundle hero image → bridge to `creative-generation`
- Draft email featuring new bundles → bridge to `copywriting`

**Artifact types:** reasoning (co-purchase analysis), image (bundle hero), text (bundle title + description)

---

## Entry 8: price_content_misalignment

**"Premium price with standard content — trust gap"** *(Verification UC-B8)*

| Field | Value |
|-------|-------|
| Fires at tier | 1 |
| Autonomy | 1 — Draft + confirm |
| Priority logic | Price premium above store median x content gap score x product revenue |

**Signals to check:**
- Products where price is significantly above store median but content attributes (image count, description length, image quality indicators) are at or below median
- Compare against store's highest-priced converting SKUs

**Tools needed:**
- `shopify_list_products` — all products with prices and content attributes
- `shopify_get_product` — detailed content check per premium product
- `shopify_update_product` — push elevated content

**Job steps:**
1. Identify products where price > 1.5x store median but content completeness < store median
2. Benchmark against highest-priced converting SKUs
3. Generate elevated content: premium lifestyle imagery, richer description, detail shots
4. Push to Shopify via `shopify_update_product` (after confirm)

**Follow-ups:**
- Generate premium ad creative for elevated SKUs → bridge to `creative-generation`
- Generate premium product video → bridge to `creative-video-generation`

**Artifact types:** reasoning (misalignment report), image (premium lifestyle shots), video (brand-quality video), text (repositioned description)
