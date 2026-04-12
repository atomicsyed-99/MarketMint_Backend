import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getBrandMemories } from "@/lib/brand-memories";
import { runWorkflowAndStream } from "@/lib/trigger-dev-client";
import { extractRequestContext } from "@/lib/artifact-upload";
import {
  readAttachmentsFromRequestContext,
  readDirectGenBmFromRequestContext,
} from "@/lib/direct-image-gen-chat-context";
import {
  extractAllChatAttachmentUrls,
  groundDeepWithChatAttachments,
} from "@/lib/ground-chat-attachment-urls";
import {
  stringFromRequestContext,
  valueFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";
import {
  deductWorkflowExecutionCredits,
  notifyPythonStoreGeneratedAssets,
} from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";

const log = createLogger("execute-workflow");

/** JSON snapshot for logs; truncates to avoid huge payloads (e.g. brand_memory). */
function safeJsonForLog(value: unknown, maxLen = 6000): string {
  try {
    const s = JSON.stringify(value, (_k, v) => {
      if (typeof v === "string" && v.length > 2000) {
        return `${v.slice(0, 2000)}…[truncated ${v.length} chars]`;
      }
      return v;
    });
    return s.length > maxLen ? `${s.slice(0, maxLen)}…[truncated]` : s;
  } catch {
    return String(value);
  }
}

function topLevelKeys(obj: Record<string, unknown> | null | undefined): string[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.keys(obj).sort();
}

type TriggerDevEvent = {
  type?: string;
  id?: string;
  data?: any;
  message?: string;
};

function extractGeneratedAssets(result: Record<string, any>): Array<{
  url: string;
  id: string;
  type: "image" | "video";
}> {
  const fromOutputAssets = Array.isArray(result?.output_assets) ? result.output_assets : [];
  const fromWorkflowOutput = Array.isArray(result?.workflow_output)
    ? result.workflow_output
    : [];
  const outputAssets = [...fromOutputAssets, ...fromWorkflowOutput];
  const assets: Array<{ url: string; id: string; type: "image" | "video" }> = [];
  const seenUrls = new Set<string>();

  for (const item of outputAssets) {
    if (!item || typeof item !== "object") continue;
    const url = typeof item.url === "string" ? item.url : "";
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const rawType =
      (typeof (item as any).output_type === "string" ? (item as any).output_type : "") ||
      (typeof (item as any).type === "string" ? (item as any).type : "");
    const outputType = rawType.toLowerCase();
    const inferredType: "image" | "video" =
      outputType === "video" || /\.mp4($|\?)/i.test(url) ? "video" : "image";
    const meta =
      (item as any).metadata && typeof (item as any).metadata === "object"
        ? ((item as any).metadata as Record<string, unknown>)
        : null;
    const idFromMeta =
      meta && typeof meta.id === "string" && meta.id ? meta.id : "";
    const id =
      typeof (item as any).id === "string" && (item as any).id
        ? (item as any).id
        : idFromMeta || crypto.randomUUID();
    assets.push({
      url,
      id,
      type: inferredType,
    });
  }

  return assets;
}

export const executeWorkflow = createTool({
  id: "execute_workflow",
  description:
    "Execute a space workflow (e.g. garment-in-lifestyle, garment-in-studio, product-swap, hero banner). Use when the loaded skill says to call execute_workflow. Requires workflow_id, use_case_id, and workflow_inputs.",
  inputSchema: z.object({
    workflow_id: z.string().describe("Workflow identifier"),
    use_case_id: z.string().describe("Use case identifier"),
    workflow_inputs: z.record(z.string(), z.any()).default({}),
    acknowledgement: z
      .string()
      .optional()
      .describe(
        "Optional one-line user-facing progress note, or omit/empty. Never include skill names, tool names, parameter lists, or phrases like 'asset catalog' or 'the skill instructs'.",
      ),
  }),
  outputSchema: z.object({
    status: z.enum(["success", "error"]),
    result: z.record(z.string(), z.any()).optional(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    const rc = context?.requestContext;
    const userId = stringFromRequestContext(rc, "userId");
    const userEmail = stringFromRequestContext(rc, "email");
    const directGenBm = readDirectGenBmFromRequestContext(rc);
    const selectedTemplatePromptId = valueFromRequestContext(
      rc,
      "selectedTemplatePromptId",
    ) as string | null | undefined;
    const chatId = stringFromRequestContext(rc, "chatId");
    const workspaceIdRaw = workspaceIdFromRequestContext(rc);
    const workspaceId = workspaceIdRaw || undefined;
    const responseMessageId = stringFromRequestContext(rc, "responseMessageId");
    const userAccessToken = stringFromRequestContext(rc, "userAccessToken");

    const writer = context?.writer?.custom?.bind(context.writer) as
      | ((event: unknown) => Promise<void> | void)
      | undefined;

    const masterToolId = crypto.randomUUID();
    const masterSteps: { id: string; title?: string; status: string; description?: string; error?: string }[] =
      [];
    const workflowErrored = { value: false };

    const useV2Format = true;

    const spaceUrl = `/spaces/${input.use_case_id}/details`;

    const correlation = {
      masterToolId,
      workflowId: input.workflow_id,
      useCaseId: input.use_case_id,
      chatId: chatId ?? null,
      responseMessageId: responseMessageId ?? null,
      workspaceId: workspaceId ?? null,
    };

    const emitMasterUpdate = async (options?: {
      status?: string;
      description?: string;
      steps?: typeof masterSteps;
      durationMs?: number;
      error?: string;
    }) => {
      if (!useV2Format || !writer) return;
      const data: any = {
        name: "execute_workflow",
        title: "Space Workflow",
        status: options?.status ?? "running",
        category: "workflow",
        description: options?.description ?? `Executing space : ${input.use_case_id}`,
        steps: options?.steps ?? masterSteps,
        space_url: spaceUrl,
      };
      if (options?.durationMs != null) data.duration_ms = options.durationMs;
      if (options?.error) data.error = options.error;
      await writer({
        type: "data-agent-utility",
        id: masterToolId,
        data,
      });
    };

    const v2Writer = async (event: TriggerDevEvent) => {
      if (!writer) return;
      const evType = event.type ?? "";

      if (evType === "progress-indicator") {
        const progress = (event as any).data ?? {};
        const title: string =
          progress.title || progress.message || "Running workflow";
        const desc: string =
          progress.description || progress.message || "";
        const status: string = progress.status || "in-progress";

        const stepId =
          (event.id && `workflow_step_${event.id}`) ||
          `workflow_step_${crypto.randomUUID().slice(0, 8)}`;

        const existing = masterSteps.find((s) => s.id === stepId);
        if (existing) {
          existing.status = status === "in-progress" ? "running" : "completed";
          existing.title = title;
          if (desc) existing.description = desc;
        } else {
          masterSteps.push({
            id: stepId,
            title,
            status: status === "in-progress" ? "running" : "completed",
            description: desc,
          });
        }
        await emitMasterUpdate({ steps: masterSteps });
        return;
      }

      if (evType === "progress") {
        const desc =
          event.message || (event as any).stage || (event as any).description;
        const stepId = `workflow_step_${crypto.randomUUID().slice(0, 8)}`;
        masterSteps.push({
          id: stepId,
          title: desc || "Running workflow",
          status: "running",
          description: desc,
        });
        await emitMasterUpdate({ steps: masterSteps });
        return;
      }

      if (evType === "complete") {
        const ev = event as Record<string, unknown>;
        const output = ev.output ?? ev.result;
        log.info(
          {
            ...correlation,
            eventId: event.id,
            hasOutput: output != null,
            outputKeys:
              output && typeof output === "object" && !Array.isArray(output)
                ? topLevelKeys(output as Record<string, unknown>)
                : null,
          },
          "trigger stream: complete",
        );
        if (workflowErrored.value) {
          await writer({
            type: `data-${evType || "workflow-event"}`,
            id: event.id,
            data: event.data ?? event,
          });
          return;
        }
        for (const step of masterSteps) {
          if (step.id.startsWith("workflow_step") && step.status === "running") {
            step.status = "completed";
          }
        }
        await emitMasterUpdate({
          status: "completed",
          description: "Workflow execution completed successfully",
          steps: masterSteps,
        });
        await writer({
          type: `data-${evType || "workflow-event"}`,
          id: event.id,
          data: event.data ?? event,
        });
        return;
      }

      if (evType === "error") {
        workflowErrored.value = true;
        const message =
          event.message || (event.data && (event.data as any).message) || "";
        log.error(
          {
            ...correlation,
            eventId: event.id,
            errorMessage: message || "(empty)",
            rawEvent: safeJsonForLog(event),
          },
          "trigger stream: error event",
        );
        const workflowSteps = masterSteps.filter((s) =>
          s.id.startsWith("workflow_step"),
        );
        if (workflowSteps.length) {
          const last = workflowSteps[workflowSteps.length - 1];
          last.status = "failed";
          last.error = message;
        }
        await emitMasterUpdate({
          status: "failed",
          description: "Workflow execution failed",
          steps: masterSteps,
          error: message,
        });
        await writer({
          type: `data-${evType || "workflow-event"}`,
          id: event.id,
          data: event.data ?? event,
        });
        return;
      }

      if (evType === "disconnected") {
        log.info(
          { ...correlation, eventId: event.id },
          "trigger stream: disconnected (stream ending)",
        );
      } else {
        log.debug(
          {
            ...correlation,
            eventId: event.id,
            evType,
            payload: safeJsonForLog(event, 2000),
          },
          "trigger stream: other event",
        );
      }

      await writer({
        type: `data-${evType || "workflow-event"}`,
        id: event.id,
        data: event.data ?? event,
      });
    };

    const fromModel: Record<string, any> = {
      ...(input.workflow_inputs ?? {}),
    };
    const chatAttachmentUrls = extractAllChatAttachmentUrls(
      readAttachmentsFromRequestContext(rc),
    );
    const groundedFromModel =
      chatAttachmentUrls.length > 0
        ? (groundDeepWithChatAttachments(
            fromModel,
            chatAttachmentUrls,
          ) as Record<string, any>)
        : fromModel;

    const workflowInputs: Record<string, any> = {
      ...groundedFromModel,
    };

    if (
      selectedTemplatePromptId &&
      !["null", "undefined", ""].includes(selectedTemplatePromptId)
    ) {
      workflowInputs.selected_template_prompt_id = selectedTemplatePromptId;
    }

    if (userId && directGenBm) {
      try {
        const memories = await getBrandMemories(userId, workspaceId);
        if (memories.length > 0) {
          const raw = memories[0].content as any;
          const data = typeof raw === "string" ? JSON.parse(raw) : raw;
          if (data && typeof data === "object") {
            workflowInputs.brand_memory = data;
          }
        }
      } catch (e) {
        log.warn({ err: e }, "failed to fetch/attach brand_memory");
      }
    }

    const modelSelection =
      workflowInputs.model_selection &&
      typeof workflowInputs.model_selection === "object"
        ? (workflowInputs.model_selection as any)
        : null;
    const model =
      modelSelection &&
      typeof modelSelection.model === "object" &&
      modelSelection.model
        ? modelSelection.model
        : null;

    if (!modelSelection || !model || !model.name || !model.output_type) {
      workflowInputs.model_selection = {
        model: {
          name: "gemini-2.5-flash-image",
          title: "Pro",
          output_type: "image",
        },
        step_id: 1,
      };
    } else if (!model.title) {
      model.title = "Pro";
    }

    const attachmentsFromRc = readAttachmentsFromRequestContext(rc);
    log.info(
      {
        ...correlation,
        workflowInputKeysFromModel: topLevelKeys(fromModel as Record<string, unknown>),
        workflowInputKeysFinal: topLevelKeys(workflowInputs as Record<string, unknown>),
        chatAttachmentUrlCount: chatAttachmentUrls.length,
        requestAttachmentsCount: Array.isArray(attachmentsFromRc)
          ? attachmentsFromRc.length
          : 0,
        chatAttachmentGroundingApplied: chatAttachmentUrls.length > 0,
        modelDefaulted:
          !modelSelection || !model || !model.name || !model.output_type,
        hasBrandMemory: workflowInputs.brand_memory != null,
        workflowInputsSummary: safeJsonForLog(workflowInputs),
      },
      "execute_workflow: invoking Trigger.dev stream",
    );

    try {
      const { result } = await runWorkflowAndStream({
        workflowId: input.workflow_id,
        useCaseId: input.use_case_id,
        workflowInputs,
        chatId: chatId ?? undefined,
        onRunStarted: async (runId) => {
          log.info({ ...correlation, triggerRunId: runId }, "trigger.dev run started");
        },
        onEvent: async (event) => {
          await v2Writer(event as TriggerDevEvent);
        },
      });

      const assetCount = extractGeneratedAssets(result).length;
      if (workflowErrored.value) {
        log.warn(
          {
            ...correlation,
            resultKeys: topLevelKeys(result),
            resultSummary: safeJsonForLog(result),
            masterStepsCount: masterSteps.length,
            extractedAssetCount: assetCount,
          },
          "execute_workflow: finished with workflow error flag (see prior trigger stream: error event)",
        );
      } else {
        log.info(
          {
            ...correlation,
            resultKeys: topLevelKeys(result),
            extractedAssetCount: assetCount,
          },
          "execute_workflow: stream finished ok",
        );
      }

      try {
        const assets = extractGeneratedAssets(result);
        if (assets.length > 0) {
          const rc = extractRequestContext(context);
          await notifyPythonStoreGeneratedAssets({
            chatId: rc.chatId ?? chatId,
            messageId: rc.messageId ?? responseMessageId,
            workspaceId: rc.workspaceId ?? workspaceId,
            toolName: "execute_workflow",
            assetData: assets,
            userEmail: rc.userEmail ?? userEmail,
            userId: rc.userId ?? userId,
            userAccessToken: rc.userAccessToken ?? userAccessToken,
            executionSource: rc.executionSource,
            jobId: rc.jobId,
            runId: rc.runId,
            jobName: rc.jobName,
          });
        }
      } catch (e) {
        log.error({ err: e }, "notifyPythonStoreGeneratedAssets failed");
      }

      if (!workflowErrored.value) {
        try {
          const rc = extractRequestContext(context);
          const billEmail = rc.userEmail ?? userEmail ?? "";
          const billWs = rc.workspaceId ?? workspaceId ?? "";
          const billChat = rc.chatId ?? chatId ?? "";
          const billMsg = rc.messageId ?? responseMessageId ?? "";
          if (
            billEmail.trim() &&
            billWs.trim() &&
            billChat.trim() &&
            result &&
            typeof result === "object"
          ) {
            const ms = workflowInputs.model_selection as Record<string, unknown> | undefined;
            const modelObj =
              ms && typeof ms === "object" && ms.model && typeof ms.model === "object"
                ? (ms.model as Record<string, unknown>)
                : null;
            const selectedModelName =
              modelObj && typeof modelObj.name === "string"
                ? modelObj.name
                : "gemini-2.5-flash-image";
            const outputType =
              modelObj && typeof modelObj.output_type === "string"
                ? modelObj.output_type
                : "image";
            await deductWorkflowExecutionCredits({
              email: billEmail,
              workspaceId: billWs,
              useCaseId: input.use_case_id,
              workflowId: input.workflow_id,
              chatId: billChat,
              selectedModelName,
              outputType,
              workflowOutput: result as Record<string, unknown>,
              idempotencyKey: `${billMsg}:execute_workflow:${input.workflow_id}`,
              userAccessToken: rc.userAccessToken ?? userAccessToken,
            });
          }
        } catch (e) {
          log.error({ err: e }, "deductWorkflowExecutionCredits failed");
        }
      }

      if (!workflowErrored.value) {
        await emitMasterUpdate({
          status: "completed",
          description: "Workflow execution completed successfully",
          steps: masterSteps,
        });
      }

      return {
        status: "success" as const,
        result,
      };
    } catch (e: any) {
      const message =
        e?.message ?? "Workflow execution failed, please try again.";
      log.error(
        {
          err: e,
          ...correlation,
        },
        "workflow execution failed (exception before/during trigger)",
      );

      await emitMasterUpdate({
        status: "failed",
        description: message,
        error: message,
      });

      return {
        status: "error" as const,
        error: message,
      };
    }
  },
});

