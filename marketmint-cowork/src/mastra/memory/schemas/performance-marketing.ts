import { z } from "zod";

export const perfMarketingWorkingMemorySchema = z.object({
  adAccounts: z
    .string()
    .optional()
    .describe(
      "Connected ad platforms and account details. Include: which platforms are connected, " +
        "account IDs, monthly budget range, and primary advertising objective. " +
        'Example: "Meta Ads connected (act_123456789). Google Ads: not connected. ' +
        'Monthly budget: $5k-8k. Primary objective: purchase conversions. Attribution: 7-day click."',
    ),

  metricBaselines: z
    .string()
    .optional()
    .describe(
      "Key performance metrics WITH campaign-level context and dates. Don't just store a single number — " +
        "capture overall and per-campaign breakdowns, targets vs actuals, and trends. " +
        "Always include the benchmark date. " +
        'Example: "Overall ROAS: 3.2 (target: 4.0) as of March 15, 2026. ' +
        "Summer Collection campaign ROAS: 4.1 (strong). Retargeting campaign ROAS: 1.8 (declining). " +
        "Overall CAC: $12. Summer campaign CAC: $8, Retargeting CAC: $18 (up from $14 in Feb). " +
        'Blended CTR: 1.4%. Best performing ad set CTR: 2.3% (Lookalike 1%)."',
    ),

  campaignIntelligence: z
    .string()
    .optional()
    .describe(
      "What's happening across campaigns — top performers, fatigue signals, budget waste, " +
        "and recent optimizations. Include campaign names, specific numbers, and dates. " +
        "Track acknowledged issues so they're not re-reported. " +
        'Example: "TOP: Summer Lifestyle campaign ($2k/day, ROAS 4.1, 3 weeks old). ' +
        "FATIGUE: Retargeting Dynamic Ads — CTR dropped 23% over 14 days, frequency 4.2, creative 28 days old. " +
        "User acknowledged fatigue March 18, requested creative refresh. " +
        "WASTE: Brand Awareness campaign spending $800/day with 0.3 ROAS — flagged for review. " +
        'RECENT: Paused 3 underperforming ad sets March 20, reallocated $500/day to Summer Lifestyle."',
    ),

  audiences: z
    .string()
    .optional()
    .describe(
      "Audience segments, their performance, and targeting notes. " +
        "Include: primary segments, best and worst performers, exclusions, and any custom audiences. " +
        'Example: "Primary segments: Lookalike 1% (best — 2.3% CTR, $8 CAC), ' +
        "Interest-based sustainability shoppers (decent — 1.6% CTR), Broad targeting (testing). " +
        "Retargeting: 30-day website visitors, Cart abandoners (7-day). " +
        'Exclusions: purchasers last 30 days, email subscribers. Custom: uploaded VIP customer list (March 10)."',
    ),

  reportingPreferences: z
    .string()
    .optional()
    .describe(
      "How the user prefers to see performance data. Include: preferred metrics, " +
        "reporting time periods, comparison windows, and format preferences. " +
        'Example: "Primary metrics: ROAS, CAC, CTR (in that order). Always compare to previous period. ' +
        "Default reporting window: last 14 days. User prefers charts over tables for trends. " +
        'Wants weekly summaries focused on spend efficiency. Currency: USD."',
    ),
});
