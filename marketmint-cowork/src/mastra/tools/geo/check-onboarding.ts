import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBrandMemories } from "@/lib/brand-memories";
import { countActiveGeoPromptsByWorkspace } from "@/db/queries/geo-prompts";
import { getLatestGeoAuditDateByWorkspace } from "@/db/queries/geo-audit-results";
import { listJobsByWorkspace } from "@/db/queries/agent-jobs";
import { emitUtility } from "@/mastra/tools/emit-utility";
import {
  getUserEmail,
  getUserId,
  getWorkspaceId,
  isBrandMemoryEnabled,
} from "./shared";

export const checkGeoOnboardingStatus = createTool({
  id: "checkGeoOnboardingStatus",
  description:
    "Check GEO onboarding progress for this workspace. Use first in GEO chats to decide whether to gate on brand memory, extract prompts, run first audit, or continue in free-form mode.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    success: z.boolean(),
    hasBrandMemoryToggle: z.boolean(),
    hasBrandMemoryData: z.boolean(),
    promptCount: z.number(),
    lastAuditDate: z.string().nullable(),
    hasMonitoringJob: z.boolean(),
    onboardingStep: z.enum([
      "enable_brand_memory",
      "extract_prompts",
      "run_first_audit",
      "ready",
    ]),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (_input, context) => {
    const utilityId = `geo_onboarding_${crypto.randomUUID().slice(0, 8)}`;
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const userId = getUserId(requestContext);
    const email = getUserEmail(requestContext);
    const hasBrandMemoryToggle = isBrandMemoryEnabled(requestContext);

    emitUtility(context, {
      id: utilityId,
      name: "checkGeoOnboardingStatus",
      title: "GEO Onboarding Check",
      category: "workflow",
      status: "running",
      description: "Checking onboarding status...",
    });

    if (!workspaceId || !userId) {
      emitUtility(context, {
        id: utilityId,
        name: "checkGeoOnboardingStatus",
        title: "GEO Onboarding Check",
        category: "workflow",
        status: "failed",
        description: "Missing workspace/user context.",
        error: "Missing workspace/user context",
      });
      return {
        success: false,
        hasBrandMemoryToggle,
        hasBrandMemoryData: false,
        promptCount: 0,
        lastAuditDate: null,
        hasMonitoringJob: false,
        onboardingStep: "enable_brand_memory" as const,
        message: "I need workspace context before GEO onboarding can continue.",
        error: "Missing workspace/user context",
      };
    }

    try {
      const promptCount = await countActiveGeoPromptsByWorkspace(workspaceId);
      const latestAudit = await getLatestGeoAuditDateByWorkspace(workspaceId);
      const jobs = await listJobsByWorkspace(workspaceId, { enabledOnly: true });
      const hasMonitoringJob = jobs.some((job) => {
        const metadata = (job.metadata ?? {}) as Record<string, unknown>;
        if (metadata.geoMonitoring === true) return true;
        const name = (job.name ?? "").toLowerCase();
        const prompt = (job.prompt ?? "").toLowerCase();
        return name.includes("geo") || prompt.includes("geo audit");
      });

      let hasBrandMemoryData = false;
      if (hasBrandMemoryToggle) {
        const memories = await getBrandMemories(userId, workspaceId);
        hasBrandMemoryData = memories.length > 0;
      }

      const onboardingStep: "enable_brand_memory" | "extract_prompts" | "run_first_audit" | "ready" = !hasBrandMemoryToggle
        ? "enable_brand_memory"
        : promptCount === 0
          ? "extract_prompts"
          : latestAudit == null
            ? "run_first_audit"
            : "ready";

      const messageByStep: Record<typeof onboardingStep, string> = {
        enable_brand_memory:
          "Please enable the Brand Memory toggle in the chatbox first. GEO cannot run without brand memory context.",
        extract_prompts:
          "Brand memory is enabled. Next step: extract your first prompt set.",
        run_first_audit:
          "Prompts are ready. Next step: run your first GEO audit.",
        ready: "Onboarding baseline exists. GEO can run in free-form mode.",
      };

      emitUtility(context, {
        id: utilityId,
        name: "checkGeoOnboardingStatus",
        title: "GEO Onboarding Check",
        category: "workflow",
        status: "completed",
        description: messageByStep[onboardingStep],
      });

      return {
        success: true,
        hasBrandMemoryToggle,
        hasBrandMemoryData,
        promptCount,
        lastAuditDate: latestAudit ? latestAudit.toISOString() : null,
        hasMonitoringJob,
        onboardingStep,
        message: messageByStep[onboardingStep],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      emitUtility(context, {
        id: utilityId,
        name: "checkGeoOnboardingStatus",
        title: "GEO Onboarding Check",
        category: "workflow",
        status: "failed",
        description: "Failed to check onboarding status.",
        error: msg,
      });
      return {
        success: false,
        hasBrandMemoryToggle,
        hasBrandMemoryData: false,
        promptCount: 0,
        lastAuditDate: null,
        hasMonitoringJob: false,
        onboardingStep: "enable_brand_memory" as const,
        message: "Could not check GEO onboarding status.",
        error: msg,
      };
    }
  },
});
