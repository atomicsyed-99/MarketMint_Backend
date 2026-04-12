import { z } from "zod";

export const geoOptimizerWorkingMemorySchema = z.object({
  brandName: z
    .string()
    .optional()
    .describe("Name of the brand being optimized for GEO."),
  onboardingComplete: z
    .string()
    .optional()
    .describe("Onboarding completion marker. Use 'yes' when onboarding is complete."),
  lastAuditSummary: z
    .string()
    .optional()
    .describe("Summary of latest GEO audit including date, citation coverage, and key gaps."),
  focusAreas: z
    .string()
    .optional()
    .describe("User-prioritized GEO themes, prompt categories, and target providers."),
  recentActions: z
    .string()
    .optional()
    .describe(
      "Summary of recently completed actions (prompts added, audits run, content generated) to avoid re-processing.",
    ),
  trackedPromptsSummary: z
    .string()
    .optional()
    .describe(
      "Quick summary of tracked prompts count, last added prompt ID and text.",
    ),
});
