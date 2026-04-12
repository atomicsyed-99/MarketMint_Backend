import { z } from "zod";

export const storeManagerWorkingMemorySchema = z.object({
  store: z
    .string()
    .optional()
    .describe(
      "Basic store information. Include: store name, URL, Shopify plan, active theme, " +
        "primary currency, primary market/region, and any notable store configuration. " +
        'Example: "Marigold Studio — marigoldstudio.myshopify.com. Shopify Plus plan. ' +
        'Dawn theme (customized). USD currency. Primary market: US, expanding to UK."',
    ),

  catalog: z
    .string()
    .optional()
    .describe(
      "Current state of the product catalog. Include: total product count, primary categories, " +
        "top-selling products, average catalog health score, and known catalog issues. " +
        "Update after audits or significant catalog changes. " +
        'Example: "142 active products across 5 collections (Dresses, Tops, Accessories, Sale, New Arrivals). ' +
        "Top sellers: Solstice Wrap Dress, Linen Wide-Leg Pants. Catalog health: 78/100. " +
        'Known issues: 47 products missing alt text, 12 products with no description, 3 duplicate SKUs."',
    ),

  healthBaselines: z
    .string()
    .optional()
    .describe(
      "Baseline metrics from the most recent store audit. Include: date of audit, SEO score, " +
        "catalog completeness percentage, inventory alert thresholds, and comparison to previous audit. " +
        "Always include the audit date so progress can be tracked. " +
        'Example: "Last audit: March 15, 2026. SEO score: 72/100 (up from 65 in Feb). ' +
        "Catalog completeness: 81% (was 74%). Alt text coverage: 67%. " +
        'Inventory alert threshold: reorder when <10 units. 5 products currently below threshold."',
    ),

  priorities: z
    .string()
    .optional()
    .describe(
      "Active issues, recurring concerns, and recent actions taken. Use this to track " +
        "what needs attention and avoid re-reporting resolved issues. " +
        'Example: "ACTIVE: Fix 47 missing alt texts (user acknowledged March 15, wants to batch-fix). ' +
        "3 duplicate SKUs need cleanup. RECURRING: Seasonal collection rotation — user updates quarterly. " +
        "RECENT ACTIONS: Added schema markup to top 20 products (March 18). " +
        'Fixed broken image links on 8 products (March 20)."',
    ),
});
