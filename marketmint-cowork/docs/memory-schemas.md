# Working Memory Schemas

> **System**: MarketMint Agent Memory Layer
> **Location**: `src/mastra/memory/`
> **Last updated**: April 9, 2026

Working memory gives each agent a structured scratchpad that persists across conversations for a given user (resource-scoped). Schemas are defined with Zod and tell the model **what to remember** and **how to format it**.

---

## Architecture overview

| Component | File | Role |
|---|---|---|
| Memory instances | `index.ts` | Creates `Memory` objects per agent, all backed by a shared `PostgresStore` |
| Orchestrator schema | `schemas/orchestrator.ts` | High-level user/brand/session context |
| Creative Director schema | `schemas/creative-director.ts` | Visual identity & generation preferences |
| Store Manager schema | `schemas/store-manager.ts` | Shopify store & catalog health |
| Performance Marketing schema | `schemas/performance-marketing.ts` | Ad accounts, campaigns & metrics |
| Email / CRM schema | `schemas/email-crm.ts` | Klaviyo flows, engagement & copy tone |

### Memory configuration by agent

| Agent | Last messages | Semantic recall | Observational memory | Working memory scope |
|---|---|---|---|---|
| **Orchestrator** | 20 | Off | Gemini 2.5 Flash (thread) | resource |
| **Creative Director** | 10 | Off | -- | resource |
| **Store Manager** | 10 | Off | -- | resource |
| **Performance Marketing** | 10 | Off | -- | resource |
| **Email / CRM** | 10 | Off | -- | resource |
| **Agent Job Manager** | 5 | Off | -- | *(none)* |

> **resource** scope = memory follows the user across threads.
> **thread** scope = memory resets per conversation.

---

## Orchestrator

**File** `schemas/orchestrator.ts` · **Agent** `MarketMintAgent`

The orchestrator is the supervisor agent. Its memory captures who the user is, what their brand looks like, and where the conversation left off — so every session can resume seamlessly.

### Fields

#### `workspace`
Who owns this workspace.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Owner identity, role, business stage, primary goals |

**Example value**
```
Priya, founder of Marigold Studio. Scaling phase.
Goals: increase ROAS above 4x, launch summer 2026 collection.
```

---

#### `brand`
Brand identity summary.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Name, niche, target audience, voice/tone, color palette, visual direction |

**Example value**
```
Marigold Studio — women's fashion.
Audience: 25-35 urban, sustainability-conscious.
Voice: warm, confident, playful.
Colors: #F5E6D3, #2D5016, #E8985E.
Visual style: clean lifestyle, natural light, neutral backgrounds.
```

---

#### `preferences`
How the user likes to interact.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Communication style, output formats, defaults, language |

**Example value**
```
Prefers concise responses. Default 4 images per generation.
Likes markdown tables for comparisons. Asks for plans before execution.
```

---

#### `integrations`
Connected platforms and services.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Platform connections, account IDs, primary platform per domain |

**Example value**
```
Connected: Shopify (marigold-studio), Meta Ads (act_123), Klaviyo.
Primary ad platform: Meta. No Google Ads yet.
```

---

#### `context`
Current projects, recent topics, and pending follow-ups.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | "Where we left off" — updated every conversation for seamless resume |

**Example value**
```
Current project: Summer 2026 collection launch.
Recent (March 28): product photography for new dresses, Meta ad performance review.
Pending: refresh fatigued retargeting creatives, schedule Klaviyo welcome flow audit.
```

---

## Creative Director

**File** `schemas/creative-director.ts` · **Agent** `creativeDirectorAgent`

Owns everything visual — brand aesthetics, generation defaults, product styling rules, and accumulated creative feedback.

### Fields

#### `visualIdentity`
The workspace's visual brand identity.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Color palette (hex), typography, photography style, mood keywords, brand asset rules |

**Example value**
```
Colors: #F5E6D3 (cream), #2D5016 (forest green), #E8985E (terracotta).
Photography: clean lifestyle, natural light, neutral linen backgrounds.
Mood: warm, airy, organic.
Logo: always bottom-right, min 40px padding.
```

---

#### `generationDefaults`
Preferred defaults for image/video generation.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Style, default count, aspect ratio, quality notes, recurring prompt modifiers |

**Example value**
```
Always generate 4 images. Default aspect ratio: 1:1 for social, 4:5 for stories.
Prefers lifestyle style over studio. Quality: high detail on textures.
Always include brand colors in background.
```

---

#### `productContext`
What the workspace sells and how products should look.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Product categories, hero products, image style rules per product type |

**Example value**
```
Women's linen dresses and accessories.
Hero products: Solstice Wrap Dress, Terracotta Tote.
Product shots: flat-lay on linen for catalog, on-model lifestyle for marketing.
Jewelry: always on light skin tone model, close-up with soft shadow.
```

---

#### `workflowPreferences`
Which generation workflows and tools the user prefers.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Workflow types (lifestyle/studio/try-on), garment defaults, video style, copy tone |

**Example value**
```
Garment: lifestyle workflow with outdoor settings.
Studio: white seamless for catalog.
Try-on: prefers diverse models.
Video: short-form reels, upbeat music.
Copy tone: playful and confident, never corporate.
```

---

#### `learnings`
Accumulated feedback from past sessions.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Positive/negative signals with specifics — what to replicate and what to avoid |

**Example value**
```
LIKED: pastel gradient backgrounds (March session), close-up texture shots, warm color grading.
AVOID: neon colors, overly busy compositions, stock-photo poses.
User said 'never use blue backgrounds' on March 20.
Flat-lay angle preferred over 45-degree for accessories.
```

---

## Store Manager

**File** `schemas/store-manager.ts` · **Agent** `shopifyStoreManagerAgent`

Tracks Shopify store health — catalog state, audit baselines, and active priorities so the agent doesn't re-report resolved issues.

### Fields

#### `store`
Basic store information.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Store name, URL, Shopify plan, theme, currency, market/region |

**Example value**
```
Marigold Studio — marigoldstudio.myshopify.com.
Shopify Plus plan. Dawn theme (customized).
USD currency. Primary market: US, expanding to UK.
```

---

#### `catalog`
Current state of the product catalog.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Product count, categories, top sellers, health score, known issues |

**Example value**
```
142 active products across 5 collections (Dresses, Tops, Accessories, Sale, New Arrivals).
Top sellers: Solstice Wrap Dress, Linen Wide-Leg Pants.
Catalog health: 78/100.
Known issues: 47 products missing alt text, 12 with no description, 3 duplicate SKUs.
```

---

#### `healthBaselines`
Baseline metrics from the most recent store audit.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Audit date, SEO score, completeness %, inventory alerts, comparison to prior audit |

**Example value**
```
Last audit: March 15, 2026.
SEO score: 72/100 (up from 65 in Feb). Catalog completeness: 81% (was 74%).
Alt text coverage: 67%.
Inventory alert threshold: reorder when <10 units. 5 products currently below threshold.
```

---

#### `priorities`
Active issues, recurring concerns, and recent actions.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Tracks what needs attention and avoids re-reporting resolved items |

**Example value**
```
ACTIVE: Fix 47 missing alt texts (user acknowledged March 15, wants to batch-fix).
3 duplicate SKUs need cleanup.
RECURRING: Seasonal collection rotation — user updates quarterly.
RECENT ACTIONS: Added schema markup to top 20 products (March 18).
Fixed broken image links on 8 products (March 20).
```

---

## Performance Marketing

**File** `schemas/performance-marketing.ts` · **Agent** `performanceMarketingAgent`

Keeps a running picture of ad performance — accounts, baselines, campaign intelligence, audiences, and how the user wants data presented.

### Fields

#### `adAccounts`
Connected ad platforms and account details.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Platform connections, account IDs, budget range, primary objective |

**Example value**
```
Meta Ads connected (act_123456789). Google Ads: not connected.
Monthly budget: $5k-8k.
Primary objective: purchase conversions. Attribution: 7-day click.
```

---

#### `metricBaselines`
Key performance metrics with campaign-level context and dates.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Overall + per-campaign breakdowns, targets vs actuals, trends, benchmark date |

**Example value**
```
Overall ROAS: 3.2 (target: 4.0) as of March 15, 2026.
Summer Collection campaign ROAS: 4.1 (strong). Retargeting ROAS: 1.8 (declining).
Overall CAC: $12. Summer CAC: $8, Retargeting CAC: $18 (up from $14 in Feb).
Blended CTR: 1.4%. Best performing ad set CTR: 2.3% (Lookalike 1%).
```

---

#### `campaignIntelligence`
What's happening across campaigns — top performers, fatigue, waste, recent actions.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Named campaigns with numbers and dates, acknowledged issues tracked to avoid re-alerting |

**Example value**
```
TOP: Summer Lifestyle campaign ($2k/day, ROAS 4.1, 3 weeks old).
FATIGUE: Retargeting Dynamic Ads — CTR dropped 23% over 14 days, frequency 4.2, creative 28 days old.
User acknowledged fatigue March 18, requested creative refresh.
WASTE: Brand Awareness campaign spending $800/day with 0.3 ROAS — flagged for review.
RECENT: Paused 3 underperforming ad sets March 20, reallocated $500/day to Summer Lifestyle.
```

---

#### `audiences`
Audience segments, performance, and targeting notes.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Primary segments, best/worst performers, exclusions, custom audiences |

**Example value**
```
Primary segments: Lookalike 1% (best — 2.3% CTR, $8 CAC),
Interest-based sustainability shoppers (decent — 1.6% CTR), Broad targeting (testing).
Retargeting: 30-day website visitors, Cart abandoners (7-day).
Exclusions: purchasers last 30 days, email subscribers.
Custom: uploaded VIP customer list (March 10).
```

---

#### `reportingPreferences`
How the user prefers to see performance data.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Preferred metrics, time windows, comparison periods, format preferences |

**Example value**
```
Primary metrics: ROAS, CAC, CTR (in that order). Always compare to previous period.
Default reporting window: last 14 days.
User prefers charts over tables for trends.
Wants weekly summaries focused on spend efficiency. Currency: USD.
```

---

## Email / CRM

**File** `schemas/email-crm.ts` · **Agent** `emailCrmManagerAgent`

Manages Klaviyo knowledge — account state, flow health, engagement baselines, segment performance, and the brand's email voice.

### Fields

#### `klaviyoAccount`
Klaviyo account overview.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Connection status, profile count, lists/segments count, active flows, sending cadence |

**Example value**
```
Klaviyo connected. 24,500 profiles. 8 lists, 15 segments.
12 active flows. Sending cadence: 2-3 campaigns/week plus automated flows.
```

---

#### `flowState`
Current state of email automation flows.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Active flows by name, missing/recommended flows, underperformers, last audit date |

**Example value**
```
ACTIVE: Welcome Series (3 emails), Abandoned Cart (2 emails),
Post-Purchase (2 emails), Browse Abandonment, Win-Back (90 day).
MISSING: Sunset flow, VIP loyalty flow, Birthday flow.
UNDERPERFORMING: Post-Purchase — 18% open rate (industry avg 40-50%), needs subject line refresh.
Last audit: March 12, 2026.
```

---

#### `engagementBaselines`
Email engagement metrics with flow-level and campaign-level breakdown.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Open rates, click rates, unsub rates, revenue/email — dated for regression tracking |

**Example value**
```
Overall (as of March 15, 2026): avg open rate 38%, avg click rate 2.1%,
unsub rate 0.15%, revenue per email $0.12.
Welcome flow: 52% open (good). Abandoned Cart: 45% open, 4.2% click (strong).
Post-Purchase: 18% open (below industry avg).
Campaign avg: 32% open, 1.8% click. Best recent: Spring Sale (48% open, 3.5% click).
```

---

#### `segmentation`
Key audience segments and list health.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Segment names, sizes, engagement levels, best performers, list hygiene concerns |

**Example value**
```
Key segments: Engaged 30-day (8,200 profiles — best click rates),
VIP buyers (1,100 — highest revenue/email), Lapsed 90-day (4,500 — win-back target).
List health: 12% unengaged profiles (>180 days no open).
Best performer: VIP segment — 58% open rate, $0.45 revenue/email.
```

---

#### `copyPreferences`
How email copy should sound for this brand.

| Detail | Value |
|---|---|
| Type | `string` (optional) |
| Purpose | Tone, subject line style, CTA preferences, phrases to use/avoid, liked examples |

**Example value**
```
Tone: warm and conversational, like a friend recommending something.
Subject lines: short (4-6 words), curiosity or urgency, emoji OK (max 1).
CTAs: action-oriented — 'Shop the look', 'Grab yours', not 'Learn more'.
AVOID: 'Dear customer', corporate language, ALL CAPS, excessive exclamation marks.
User loved: 'Your summer wardrobe called 📞' from March campaign.
```

---

## Design decisions

**Why free-form strings instead of structured objects?**
Each field is a single `string` rather than a nested object. This is intentional — it gives the model maximum flexibility to capture nuance, include examples, and evolve the format over time without schema migrations. The `.describe()` on each field acts as a formatting guide so the model produces consistent, parseable values.

**Why resource scope?**
All working memory (except the job manager) is scoped to the **resource** (user). This means the agent remembers a user's brand, preferences, and baselines across every conversation thread — not just the current one.

**Why no semantic recall?**
Semantic recall is disabled for all agents. The working memory schemas are designed to be comprehensive enough that keyword-based message history (via `lastMessages`) plus the structured scratchpad cover what the agents need without the latency/cost of embedding search.
