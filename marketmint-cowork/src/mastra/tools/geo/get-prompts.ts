import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { listGeoPromptsByWorkspace } from "@/db/queries/geo-prompts";
import { listGeoAuditResultsByWorkspace } from "@/db/queries/geo-audit-results";
import { getWorkspaceId, isBrandMemoryEnabled } from "./shared";

export const getGeoPrompts = createTool({
  id: "getGeoPrompts",
  description: "List saved GEO prompts for this workspace and latest audit status.",
  inputSchema: z.object({
    activeOnly: z.boolean().optional().default(true),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    prompts: z.array(
      z.object({
        id: z.string(),
        promptText: z.string(),
        category: z.string().nullable(),
        source: z.enum(["auto", "manual"]),
        isActive: z.boolean(),
        latestAuditAt: z.string().nullable(),
        latestByProvider: z.record(
          z.string(),
          z.object({
            isCited: z.boolean(),
            citationRank: z.number().nullable(),
            citationUrl: z.string().nullable(),
            auditedAt: z.string(),
          }),
        ),
      }),
    ),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const requestContext = context?.requestContext;
    const workspaceId = getWorkspaceId(requestContext);
    const enabled = isBrandMemoryEnabled(requestContext);

    if (!enabled) {
      return {
        success: false,
        prompts: [],
        message: "Please enable the Brand Memory toggle in the chatbox first before using GEO prompts.",
        error: "Brand memory toggle is off",
      };
    }
    if (!workspaceId) {
      return {
        success: false,
        prompts: [],
        message: "Missing workspace context.",
        error: "Missing workspace context",
      };
    }

    try {
      const prompts = await listGeoPromptsByWorkspace(workspaceId, {
        activeOnly: input.activeOnly,
      });

      const audits = await listGeoAuditResultsByWorkspace(workspaceId, {
        promptIds: prompts.map((p) => p.id),
      });

      const promptAuditMap = new Map<
        string,
        {
          latestAuditAt: Date | null;
          latestByProvider: Record<
            string,
            {
              isCited: boolean;
              citationRank: number | null;
              citationUrl: string | null;
              auditedAt: string;
            }
          >;
        }
      >();

      for (const audit of audits) {
        const existing = promptAuditMap.get(audit.promptId) ?? {
          latestAuditAt: null,
          latestByProvider: {},
        };
        if (!existing.latestAuditAt || audit.auditedAt > existing.latestAuditAt) {
          existing.latestAuditAt = audit.auditedAt;
        }
        if (!existing.latestByProvider[audit.provider]) {
          existing.latestByProvider[audit.provider] = {
            isCited: audit.isCited,
            citationRank: audit.citationRank ?? null,
            citationUrl: audit.citationUrl ?? null,
            auditedAt: audit.auditedAt.toISOString(),
          };
        }
        promptAuditMap.set(audit.promptId, existing);
      }

      const result = prompts.map((p) => {
        const stat = promptAuditMap.get(p.id);
        return {
          id: p.id,
          promptText: p.promptText,
          category: p.category ?? null,
          source: p.source,
          isActive: p.isActive,
          latestAuditAt: stat?.latestAuditAt ? stat.latestAuditAt.toISOString() : null,
          latestByProvider: stat?.latestByProvider ?? {},
        };
      });

      return {
        success: true,
        prompts: result,
        message: `Found ${result.length} GEO prompts.`,
      };
    } catch (error) {
      return {
        success: false,
        prompts: [],
        message: "Failed to load GEO prompts.",
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  },
});
