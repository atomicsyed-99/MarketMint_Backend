import { z } from "zod";

export const orchestratorWorkingMemorySchema = z.object({
  workspace: z
    .string()
    .optional()
    .describe(
      "Who owns this workspace. Include: owner name, role (founder/marketer/agency), " +
        "company name, business stage (pre-launch/growing/scaling), and primary goals. " +
        'Example: "Priya, founder of Marigold Studio. Scaling phase. Goals: increase ROAS above 4x, launch summer 2026 collection."',
    ),

  brand: z
    .string()
    .optional()
    .describe(
      "Brand identity summary. Include: brand name, industry/niche, target audience demographics " +
        "and psychographics, voice/tone keywords, color palette (hex codes), typography notes, " +
        "and visual style direction. Align this field with what you learn from the user and tools; do not claim no saved brand memory when generation tools applied workspace memory. " +
        'Example: "Marigold Studio — women\'s fashion. Audience: 25-35 urban, sustainability-conscious. ' +
        "Voice: warm, confident, playful. Colors: #F5E6D3, #2D5016, #E8985E. " +
        'Visual style: clean lifestyle, natural light, neutral backgrounds."',
    ),

  preferences: z
    .string()
    .optional()
    .describe(
      "How the user likes to interact. Include: communication style (concise/detailed), " +
        "preferred output formats (tables, bullet points), default image count, " +
        "language preferences, and any explicit requests about response style. " +
        'Example: "Prefers concise responses. Default 4 images per generation. Likes markdown tables for comparisons. Asks for plans before execution."',
    ),

  integrations: z
    .string()
    .optional()
    .describe(
      "Connected platforms and services. Include: which platforms are connected " +
        "(Shopify, Meta Ads, Google Ads, Klaviyo, etc.), store/account identifiers, " +
        "and the primary platform for each domain. " +
        'Example: "Connected: Shopify (marigold-studio), Meta Ads (act_123), Klaviyo. Primary ad platform: Meta. No Google Ads yet."',
    ),

  context: z
    .string()
    .optional()
    .describe(
      "Current projects, recent conversation topics, and pending follow-ups. " +
        "This is the 'where we left off' section — update it every conversation so the " +
        "next session can resume seamlessly. Include dates for time-sensitive items. " +
        "Copy facts from tool outputs only — do not contradict successful generation that used workspace brand memory. " +
        'Example: "Current project: Summer 2026 collection launch. ' +
        "Recent (March 28): product photography for new dresses, Meta ad performance review. " +
        'Pending: refresh fatigued retargeting creatives, schedule Klaviyo welcome flow audit."',
    ),
});
