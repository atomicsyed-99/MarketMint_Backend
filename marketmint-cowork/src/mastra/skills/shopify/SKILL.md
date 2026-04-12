---
name: shopify
description: 'Use when the user has a connected Shopify store (via Admin API connector) and asks about store performance, product optimization, inventory, orders, or wants proactive recommendations. This is the base Shopify intelligence skill — it guides signal computation and routes to band-specific skills for execution.'
---

# Shopify Intelligence — Store Operations Playbook

> **STOP — Connection check:** If Shopify is NOT listed in the user's connected services (no Admin API connector), do NOT use this skill. The presence of Shopify connector tools in `search_tools` results indicates the connection is active. If not connected, direct the user to the `shopify-storefront` skill for public catalog browsing, or suggest they connect Shopify from the integrations panel.

This skill activates when Shopify is connected via the Admin API connector. It provides the operational framework for analyzing store data, computing business signals, and surfacing prioritized recommendations.

**Core principle:** The LLM fetches, computes, interprets, and creates. Functions retrieve. Rules constrain. You derive all business metrics from raw connector data — you never receive pre-computed numbers, and you never invent numbers not present in the fetched data.

> **Public catalog browsing** (unauthenticated, no Admin API): Use `shopify-storefront` skill instead.
> **Authenticated store operations** (Admin API): You are in the right place.

**Registry extensibility:** This skill system is a version-controlled config. Adding a new JTBD = adding a new entry to a band skill. No prompt changes, no pipeline rebuild.

---

## The 5-Layer Pipeline

### Layer 1 — Data Acquisition

Fetch raw data using connector tools via `search_tools` + `load_tool`.

**Always fetch first** (call `shopify_get_shop` before any other tool — you need the store currency):

| Data needed | Tool to search/load | Notes |
|------------|---------------------|-------|
| Store info (currency, plan, timezone) | `shopify_get_shop` | **CALL FIRST** — prices are raw numbers, need currency |
| Product catalog | `shopify_list_products` | Filter by status, type, collection |
| Single product detail | `shopify_get_product` | Includes variants, images, metafields |
| Product count | `shopify_count_products` | Quick health check |
| Orders (recent) | `shopify_list_orders` | Filter: status, financial_status |
| Order count | `shopify_count_orders` | For velocity calculations |
| Inventory levels | `shopify_get_inventory_levels` | Stock across all locations |
| Locations | `shopify_list_locations` | Multi-location stores |
| Customers | `shopify_list_customers` / `shopify_search_customers` | For cohort analysis |
| Collections | `shopify_list_collections` / `shopify_list_smart_collections` | Catalog organization |
| Pages | `shopify_list_pages` | Content audit |
| Themes | `shopify_list_themes` | Active theme identification |

**What is synced locally vs fetched live:**
- **Synced** (queryable copy): Product catalog, collections, pages, blog articles, navigation menus, discount codes
- **Fetched live** (too volatile): Inventory levels, current pricing, orders, customer data

**Conflict resolution:** If you write a change (e.g., update product), push to Shopify immediately. The local copy updates on next sync or webhook.

**Inventory levels two-step:** `shopify_get_inventory_levels` requires `inventory_item_ids`. Get these from product variants first (`shopify_get_product` → variants → inventory_item_id), then call `shopify_get_inventory_levels` with those IDs.

**Phase 2 (future):** Periodic data pulls via configurable heartbeat. Data arrives pre-fetched rather than pulled on demand. The LLM still interprets — only the data delivery changes.

### Layer 2 — Signal Computation

Derive business metrics from the raw data you fetched. **You compute these — they are not pre-calculated.** Show all derived values explicitly so they are verifiable.

**Why LLM-computed rather than backend functions:** Analytics connectors (GA4, PostHog) have variable event naming — clients configure their own taxonomies. A backend function can't account for these in advance. The LLM reads the event schema in context and derives the correct metric regardless of naming. This unified approach keeps the architecture consistent across all connectors.

**Tier 1 signals (Shopify only):**

| Signal | How to compute | Tools needed |
|--------|---------------|-------------|
| Content completeness | For each product: check meta_title, meta_description, body_html length (>100 words?), image alt_text, image count. Score 0.0–1.0. List gaps. | `shopify_list_products`, `shopify_get_product` |
| Inventory velocity | `units_per_day = orders_last_30d / 30`. `days_remaining = current_stock / units_per_day` | `shopify_list_orders` (last 30d), `shopify_get_inventory_levels` |
| Catalog health | `completeness_pct`, `draft_count`, `missing_seo_count` across all products | `shopify_list_products` (all statuses), `shopify_count_products` |
| Revenue concentration | Top SKU revenue share from last 90d orders. Flag if top 2 SKUs > 60% of revenue. | `shopify_list_orders` (last 90d) |
| New vs returning customer mix | Compare new customer order count vs returning in last 30d. Derive repeat rate. | `shopify_list_orders` + `shopify_list_customers` |

**Tier 2+ signals (with additional connectors):**

| Signal | Requires | How to compute |
|--------|----------|---------------|
| Conversion rate | GA4 | CVR from GA4 sessions vs Shopify orders. Compare product CVR to store average. |
| Ad efficiency | Meta/Google Ads | ROAS, CTR, daily spend. Flag fatigue if 7d CTR < 70% of 30d CTR. |
| Mobile vs desktop CVR | GA4 | Compare device-segmented CVR. Flag if gap > 30%. |
| Checkout funnel drop-off | GA4 | Identify drop-off step. Compute checkout-to-purchase rate. |
| Contribution margin | Shopify + Ads | `margin = revenue - COGS - ad_spend - fees`. Flag compression if 7d < 30d avg. |

**Graceful degradation:** If a connector is not connected, those signals are simply unavailable. Do not error. Do not mention missing connectors unless the user asks why a specific insight isn't available.

### Layer 3 — JTBD Evaluation

After computing signals, evaluate which Jobs-To-Be-Done apply. Use the priority band system:

| Band | Priority | Example Triggers | Load Skill |
|------|----------|-----------------|------------|
| **Band 1 — Revenue at Risk** | HIGHEST | CVR < 70% of benchmark + active ad spend; inventory < 14 days + spend > $0; refund spike | **shopify/revenue-risks** |
| **Band 2 — Quick Wins** | HIGH | No SEO meta + 100+ daily visitors; no alt text on product images | **shopify/quick-wins** |
| **Band 3 — Growth** | MEDIUM | Search terms with no matching content; top creative with no variants; bundle gaps | **shopify/growth** |
| **Band 4 — Maintenance** | LOW | 12+ products in draft; description not updated in 90 days; new launch needs content | **shopify/maintenance** |

**Band loading rule:** Load the highest-priority band skill first. If recommendations span multiple bands, load additional band skills as needed. Never load more than 2 band skills in a single response.

**Evaluation rules:**
1. Scan signals top-down (Band 1 first, Band 4 last)
2. Surface the **top 2-3 recommendations** only — not everything
3. **Bundle overlapping JTBDs**: If two JTBDs apply to the same product, present them as one recommendation

**Bundling examples:**
- `active_spend_low_cvr` + `stockout_while_spending` on same product → "Your [product] has two compounding problems: the PDP isn't converting and you're 8 days from stockout while spending $45/day on ads."
- `high_traffic_missing_seo` + `pdp_content_incomplete` on same product → "Your [product] gets 120 daily visitors but has thin content and no SEO meta — I can fix both in one pass."

### Session Categories

When the user opens a Shopify-related conversation, classify the intent into one of these categories to choose the right approach:

| Category | User intent | Example triggers | Approach |
|----------|------------|-----------------|----------|
| **A — Know where to focus** | Disoriented or agenda-less. Wants to know what's worth their attention. | "What should I work on?", "How did we do this week?", "Revenue is down and I don't know why" | Run Quick Audit → compute signals → load band skill → present recommendations |
| **B — Create & improve content** | Knows what they want to improve. Wants creative output. | "Rewrite the description for X", "Generate new images for Y", "We're launching a new product" | Pull product data for context → load band skill for diagnosis → bridge to creative skills for artifact production |
| **C — Understand performance** | Wants to understand something that happened. | "Did our promo work?", "How's our repeat rate?", "Why are returns up?" | Fetch order/customer data → derive metrics → present analysis with follow-up content fix |
| **D — Plan ahead** | Strategic, forward-looking mode. | "Plan for Valentine's Day", "We're expanding into a new category" | Historical data analysis → opportunity brief → bridge to creative skills for production |

**Creative skill bridges:** After diagnosis or analysis, many sessions transition into content production. When the job steps call for generating images, video, or copy:
- Hero images / ad creative → bridge to `creative-generation` skill with product image URLs as `asset_urls` and diagnosis summary as `user_prompt`
- Product descriptions / email copy → bridge to `copywriting` skill with store benchmarks and brand context
- Product videos → bridge to `video-generator` or `creative-video-generation` skill
- SEO meta / alt text → handle directly via `shopify_update_product`

The data-informed context from the diagnosis phase (store benchmarks, top performer patterns, gap analysis) becomes the creative brief for the generation phase.

### Quick Audit Sequence

When the user asks "what should I focus on?" or "audit my store", run all five tool calls in a single parallel batch to get a baseline:

- `shopify_get_shop` — currency, plan, timezone
- `shopify_list_products` (status=active) — catalog overview
- `shopify_count_products` — total counts by status
- `shopify_list_orders` (status=any, limit=50) — recent order velocity
- `shopify_list_collections` — collection health

Then compute Tier 1 signals from the results before loading a band skill.

### Layer 4 — Context Injection

When presenting recommendations, structure your analysis using this format:

```
<store_intelligence>
  Fetched: [current timestamp]
  Connected: [list connected services]
  Intelligence tier: [1/2/3]
  Currency: [from shopify_get_shop]

  RAW SIGNAL DATA:
  [structured payload of fetched connector data]

  DERIVED SIGNALS:
  [each computed signal with explicit values — show your work]

  JTBD CONTEXT:
  [priority framework + which band skills apply]

  BEHAVIORAL RULES:
  - Derive all metrics from the signal data above. Show derived values explicitly.
  - Never invent or estimate metrics not derivable from provided data.
  - Surface top 2-3 recommendations in priority band order.
  - Bundle multiple JTBDs on the same product into one recommendation.
  - Do not list capabilities unprompted.
  - After every action, consult FOLLOW_UP_MAP.
  - Never recommend price changes without explicit re-confirmation.
  - Tier 2+: include performance-based recommendations alongside content signals.
</store_intelligence>
```

### Layer 5 — Conversation & Execution

Present recommendations conversationally. Example:

```
USER: "What should I focus on today?"

AGENT (after computing signals):
  "Two things stood out from your store data:

   Your Silk Saree is getting 2.3% CTR on Meta — people are clicking —
   but only converting at 0.8% on site (your store average is 2.1%).
   And you have 8 days of stock left while spending $45/day on ads.
   I'd recommend pausing the ads now, fixing the product page,
   then relaunching.

   Separately, your Cotton Kurta Set gets 120 daily visitors but has
   no SEO meta or image alt text. I can fix both in about 2 minutes.

   Which would you like to tackle?"

USER: "Pause the saree ads and fix the page."

AGENT: [pauses ads, generates new description, shows draft]

  "Done — ads paused. Here's a new description for the Silk Saree:
   [generated copy]

   Want me to push this to Shopify? I can also set up an A/B test
   to compare it against the current version once ads are back on."

   ↑ FOLLOW-UP RULES firing:
     completed_action: rewrote_product_description
     → suggest: push_to_shopify (high), setup_ab_test (medium)
```

After the user approves an action:
1. Execute via the appropriate connector tools
2. Consult the **FOLLOW_UP_MAP** below
3. Suggest the next logical action with confidence level

---

## Behavioral Rules (NON-NEGOTIABLE)

1. **Derive all metrics from fetched data.** Show derived values explicitly. Never invent or estimate metrics not derivable from provided data.
2. **Call `shopify_get_shop` first** — always. Prices are raw numbers; you need the store currency.
3. **Never recommend price changes without explicit re-confirmation** from the user.
4. **For WRITE operations** (create, update, delete): confirm with user before executing. Show exactly what will change.
5. **Do not list capabilities unprompted.** Respond to what the user asks.
6. **Surface top 2-3 recommendations** in priority band order. Do not dump everything.
7. **Bundle overlapping JTBDs** on the same product into one recommendation.
8. **After every completed action**, consult the FOLLOW_UP_MAP below.
9. **Tier awareness**: Only surface recommendations achievable with connected services. Do not suggest actions requiring unconnected services.
10. **Tier 2+**: Include performance-based recommendations alongside content signals when ad/analytics connectors are connected.

**Why prompt-based evaluation (not a backend matcher):** A backend matcher evaluating YAML trigger conditions adds engineering complexity with limited gain. The LLM reading signal outputs against JTBD context produces equivalent recommendations with less infrastructure. As the registry grows, new entries extend the skill context — no pipeline changes required.

---

## FOLLOW_UP_MAP

After completing any action, consult this map and suggest the next step:

| Completed Action | Suggest Next (high confidence) | Suggest Next (medium confidence) |
|-----------------|-------------------------------|--------------------------------|
| `rewrote_product_description` | push_to_shopify | setup_ab_test_vs_current |
| `pushed_product_update` | generate_matching_seo_meta | apply_fix_to_similar_skus |
| `generated_seo_meta` | push_to_shopify | generate_matching_og_image, suggest_internal_linking_from_blog |
| `generated_alt_text_batch` | push_to_shopify | audit_accessibility_completeness |
| `paused_ads` | diagnose_pdp, generate_pdp_rewrite | draft_scarcity_messaging_if_intentional |
| `generated_collection_description` | push_to_shopify | generate_blog_post_linking_to_collection |
| `published_draft_products` | add_to_relevant_collections | suggest_inclusion_in_next_campaign |
| `generated_new_creative` | push_creative_to_shopify | setup_ab_test_new_vs_current_creative |
| `sized_lapsed_segment` | draft_winback_email_sequence | ab_test_offer_vs_no_offer |
| `drafted_email_sequence` | surface_for_klaviyo_deployment | monitor_open_rate_on_new_flow |
| `surfaced_financial_brief` | recommend_spend_pause_or_reduction | suggest_retention_focus_over_acquisition |
| `diagnosed_cvr_drop` | flag_for_theme_rollback | check_payment_method_status |
| `restocked_product` | relaunch_ads | draft_back_in_stock_flow |
| `diagnosed_refund_spike` | generate_realistic_imagery, rewrite_description | generate_clarifying_video, generate_size_guide |
| `completed_promo_debrief` | generate_next_promo_brief | generate_promo_creative, draft_promo_email |
| `created_bundle_product` | add_to_collection | generate_bundle_hero_image, draft_bundle_email |
| `fixed_price_content_gap` | generate_premium_ad_creative | generate_premium_product_video |
| `launched_new_product` | set_14day_velocity_benchmark | generate_launch_email_banner, generate_ad_creative |
| `generated_seasonal_content` | create_seasonal_collection | generate_seasonal_email_banner, generate_seasonal_ads |

---

## Autonomy Levels

Each JTBD entry has a `max_autonomy_level`:

| Level | Behavior | Examples |
|-------|----------|---------|
| 0 — Alert only | Surface the finding. Do not draft or execute without user asking. | Revenue at risk alerts, price-related actions |
| 1 — Draft + confirm | Generate the fix (e.g., new description), show it, wait for approval before pushing. | SEO meta generation, alt text, content rewrites |
| 2 — Execute autonomously | Only if user has explicitly opted in per action type. **Never a default.** | Future phase — not active yet |

---

## Use Case Traceability

How the 23 use cases from the verification spec map to JTBD entries:

| Use Case | Category | Covered By |
|----------|----------|-----------|
| UC-A1: Store scan | A | Quick Audit Sequence → all Tier 1 signals |
| UC-A2: Hunch investigation | A | `pdp_content_incomplete` + `active_spend_low_cvr` |
| UC-A3: Weekly self-check | A | Quick Audit Sequence → Tier 1 signals (revenue concentration, catalog health) |
| UC-A4: Revenue drop investigation | A | `cvr_drop_anomaly` + `stockout_while_spending` |
| UC-A5: New customer quality check | A | Tier 1: new vs returning signal. Tier 3: `high_cac_low_ltv_cohort` |
| UC-A6: Catalog gap audit | A | Catalog health signal + `pdp_content_incomplete` + `images_missing_alt_text` |
| UC-B1: Direct content request | B | `pdp_content_incomplete` → bridge to `creative-generation` / `copywriting` |
| UC-B2: New product launch | B | `new_product_launch_setup` → bridge to creative skills |
| UC-B3: Batch catalog refresh | B | `stale_product_descriptions` + `pdp_content_incomplete` at scale |
| UC-B4: Systemic pattern fix | B | Catalog health signal → `pdp_content_incomplete` at scale |
| UC-B5: Content from customer signal | B | `pdp_content_incomplete` (user provides qualitative input) |
| UC-B6: Dead stock content rescue | B | `revenue_concentration_risk` + `bundle_crosssell_gaps` |
| UC-B7: New category brief | B | `new_product_launch_setup` (category-level) |
| UC-B8: Price-content alignment | B | `price_content_misalignment` |
| UC-B9: Seasonal content | B/D | `seasonal_content_refresh` |
| UC-B10: Ad creative generation | B | `creative_fatigue_detected` → bridge to `creative-generation` |
| UC-C1: Promo debrief | C | `promo_debrief` |
| UC-C2: Retention health check | C | Tier 1: new vs returning signal. Tier 3: `high_cac_low_ltv_cohort` |
| UC-C3: Channel performance | C | Tier 2: ad efficiency signal. `creative_fatigue_detected` |
| UC-C4: Refund spike | C | `refund_spike_detected` |
| UC-C5: Launch post-mortem | C | `new_product_launch_setup` follow-ups (14-day review) |
| UC-C6: Abandoned cart analysis | C | Tier 2: `checkout_friction_detected`. Tier 1: product-level from order data |
| UC-C7: AOV decline | C | Revenue concentration signal + `promo_debrief` + `bundle_crosssell_gaps` |

---

## Related Skills

- **shopify/revenue-risks** — Band 1 JTBDs (7): active spend + low CVR, stockout risk, CVR anomalies, high CAC, checkout friction, mobile regression, refund spikes
- **shopify/quick-wins** — Band 2 JTBDs (7): missing SEO, missing alt text, thin PDPs, collection content gaps, Klaviyo flow gaps, winback, search term gaps
- **shopify/growth** — Band 3 JTBDs (8): creative fatigue, top creative replication, revenue concentration, margin compression, CAC above break-even, promo debrief, bundle/cross-sell gaps, price-content alignment
- **shopify/maintenance** — Band 4 JTBDs (4): stuck drafts, stale descriptions, new product launch setup, seasonal content refresh
- **shopify-storefront** — Public catalog browsing (unauthenticated, different from this skill)
