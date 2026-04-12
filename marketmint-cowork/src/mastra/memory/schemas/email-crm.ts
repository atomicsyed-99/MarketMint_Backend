import { z } from "zod";

export const emailCrmWorkingMemorySchema = z.object({
  klaviyoAccount: z
    .string()
    .optional()
    .describe(
      "Klaviyo account overview. Include: connection status, total profile count, " +
        "number of lists and segments, number of active flows, and sending frequency/cadence. " +
        'Example: "Klaviyo connected. 24,500 profiles. 8 lists, 15 segments. ' +
        '12 active flows. Sending cadence: 2-3 campaigns/week plus automated flows."',
    ),

  flowState: z
    .string()
    .optional()
    .describe(
      "Current state of email automation flows. Include: active flows by name, " +
        "missing/recommended flows, underperforming flows with metrics, and last audit date. " +
        'Example: "ACTIVE: Welcome Series (3 emails), Abandoned Cart (2 emails), Post-Purchase (2 emails), ' +
        "Browse Abandonment, Win-Back (90 day). " +
        "MISSING: Sunset flow, VIP loyalty flow, Birthday flow. " +
        "UNDERPERFORMING: Post-Purchase flow — 18% open rate (industry avg 40-50%), needs subject line refresh. " +
        'Last audit: March 12, 2026."',
    ),

  engagementBaselines: z
    .string()
    .optional()
    .describe(
      "Email engagement metrics with flow-level and campaign-level breakdown. " +
        "Include dates so regressions can be tracked across sessions. " +
        'Example: "Overall (as of March 15, 2026): avg open rate 38%, avg click rate 2.1%, ' +
        "unsub rate 0.15%, revenue per email $0.12. " +
        "Welcome flow: 52% open (good). Abandoned Cart: 45% open, 4.2% click (strong). " +
        "Post-Purchase: 18% open (below industry avg 40-50%). " +
        'Campaign avg: 32% open, 1.8% click. Best recent campaign: Spring Sale (48% open, 3.5% click)."',
    ),

  segmentation: z
    .string()
    .optional()
    .describe(
      "Key audience segments and list health. Include: segment names, sizes, engagement levels, " +
        "and which segments perform best. Note any list hygiene concerns. " +
        'Example: "Key segments: Engaged 30-day (8,200 profiles — best click rates), ' +
        "VIP buyers (1,100 — highest revenue/email), Lapsed 90-day (4,500 — win-back target). " +
        "List health: 12% unengaged profiles (>180 days no open). " +
        'Best performer: VIP segment — 58% open rate, $0.45 revenue/email."',
    ),

  copyPreferences: z
    .string()
    .optional()
    .describe(
      "How email copy should sound for this brand. Include: tone, subject line style, " +
        "CTA preferences, phrases to use and avoid, and any specific examples the user liked. " +
        'Example: "Tone: warm and conversational, like a friend recommending something. ' +
        "Subject lines: short (4-6 words), use curiosity or urgency, emoji OK (but max 1). " +
        "CTAs: action-oriented — 'Shop the look', 'Grab yours', not 'Learn more' or 'Click here'. " +
        "AVOID: 'Dear customer', corporate language, ALL CAPS, excessive exclamation marks. " +
        'User loved the subject line \'Your summer wardrobe called 📞\' from March campaign."',
    ),
});
