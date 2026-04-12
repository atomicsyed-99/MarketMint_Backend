/**
 * V3 behavior:
 * 1) Store generated assets directly via assets service.
 * 2) Deduct credits via Python backend only (marketmint-pro-backend).
 */

import { env } from "@/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { createLogger } from "@/lib/logger";

const log = createLogger("assets-credits");

/** Whitelist of valid asset types sent to the Asset Manager Service. */
const VALID_ASSET_TYPES = new Set(["image", "video", "artifact"]);

/** ServiceName enum values from marketmint-pro-backend `app/dtos/services.py`. */
export type PythonCreditServiceName =
  | "image_gen"
  | "edit_image"
  | "single_shot_video_gen"
  | "video_image_gen"
  | "video_clip_gen"
  | string;

export type AssetItem = {
  url: string;
  id: string;
  /** Asset type: "image", "video", or "artifact" */
  type: string;
  /** Optional metadata — for artifacts: { artifactKind, mimeType, filename, ... } */
  metadata?: Record<string, unknown>;
};

export type CreditDeductionCharge = {
  serviceName: PythonCreditServiceName;
  quantity: number;
};

/** POST target for the standalone assets service (global prefix `assets`, no `/v1/generated`). */
function resolveAssetsPostUrl(base: string): string {
  const trimmed = base.replace(/\/$/, "");
  return trimmed.endsWith("/assets") ? trimmed : `${trimmed}/assets`;
}

function creditsBaseUrl(): string {
  return (env.CREDITS_BACKEND_BASE_URL ?? env.BACKEND_BASE_URL ?? "").replace(/\/$/, "");
}

function resolveAssetReferencePayload(options: {
  chatId?: string;
  messageId?: string;
  toolName: string;
  executionSource?: string;
  jobId?: string;
  runId?: string;
}): {
  referenceType: string;
  referenceId: string;
  referenceName: string;
  metadata: Record<string, unknown>;
} {
  const metadata: Record<string, unknown> = {
    messageId: options.messageId ?? "",
    toolName: options.toolName,
  };
  if (options.executionSource === "scheduled_job") {
    metadata.executionSource = options.executionSource;
    if (options.jobId) metadata.jobId = options.jobId;
    if (options.runId) metadata.runId = options.runId;
  }
  return {
    referenceType: "chat",
    referenceId: options.chatId ?? "",
    referenceName: options.toolName,
    metadata,
  };
}

export type DeductCreditsByServiceParams = {
  email: string;
  workspaceId: string;
  serviceName: PythonCreditServiceName;
  quantity: number;
  idempotencyKey: string;
  userAccessToken?: string;
  /** Mastra tool id — backend uses for remarks + metadata when remarks not overridden. */
  toolName?: string;
  /** Explicit ledger remarks (optional; scheduled jobs usually use jobName instead). */
  remarks?: string;
  executionSource?: string;
  /** Scheduled agent job display name — backend uses as remarks when executionSource is scheduled_job. */
  jobName?: string;
  agentJobId?: string;
  agentJobRunId?: string;
};

/** Single POST with quantity (backend `consume_credits_for_service` req_count). */
export async function deductCreditsByService(
  params: DeductCreditsByServiceParams,
): Promise<void> {
  const creditsBase = creditsBaseUrl();
  const apiKey = env.ASSET_MANAGER_SERVICE_AUTH_KEY ?? "";
  if (!creditsBase || !apiKey) {
    log.warn("missing CREDITS_BACKEND_BASE_URL or ASSET_MANAGER_SERVICE_AUTH_KEY; skipping credits");
    return;
  }
  if (!params.email?.trim() || !params.workspaceId?.trim()) {
    log.warn("missing email/workspaceId; skipping credits deduction");
    return;
  }
  const qty = Math.max(0, Math.floor(params.quantity));
  if (qty <= 0) return;

  const creditsUrl = `${creditsBase}/credits/deduct-credits`;
  const creditsHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "Idempotency-Key": params.idempotencyKey,
  };
  if (params.userAccessToken) {
    creditsHeaders.Authorization = `Bearer ${params.userAccessToken}`;
  }
  const body: Record<string, unknown> = {
    email: params.email,
    workspace_id: params.workspaceId,
    service_name: params.serviceName,
    quantity: qty,
    job_id: params.idempotencyKey,
  };
  if (params.toolName) body.tool_name = params.toolName;
  if (params.remarks) body.remarks = params.remarks;
  if (params.executionSource) body.execution_source = params.executionSource;
  if (params.jobName) body.job_name = params.jobName;
  if (params.agentJobId) body.agent_job_id = params.agentJobId;
  if (params.agentJobRunId) body.agent_job_run_id = params.agentJobRunId;

  const creditsRes = await fetchWithTimeout(creditsUrl, {
    method: "POST",
    headers: creditsHeaders,
    body: JSON.stringify(body),
  });
  if (!creditsRes.ok) {
    const text = await creditsRes.text();
    log.error({ status: creditsRes.status, body: text.slice(0, 500) }, "credits deduction failed");
  }
}

export type DeductWorkflowCreditsParams = {
  email: string;
  workspaceId: string;
  useCaseId: string;
  workflowId: string;
  chatId: string;
  selectedModelName: string;
  outputType: string;
  workflowOutput: Record<string, unknown>;
  idempotencyKey: string;
  userAccessToken?: string;
  isTestFunction?: boolean;
};

/** Same billing as Python `execute_workflow` → `calculate_and_deduct_credits_for_workflow`. */
export async function deductWorkflowExecutionCredits(
  params: DeductWorkflowCreditsParams,
): Promise<void> {
  const creditsBase = creditsBaseUrl();
  const apiKey = env.ASSET_MANAGER_SERVICE_AUTH_KEY ?? "";
  if (!creditsBase || !apiKey) {
    log.warn("missing credits base URL or ASSET_MANAGER_SERVICE_AUTH_KEY; skipping workflow credits");
    return;
  }
  if (!params.email?.trim() || !params.workspaceId?.trim()) {
    log.warn("missing email/workspaceId; skipping workflow credits");
    return;
  }

  const url = `${creditsBase}/credits/deduct-workflow-credits`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "Idempotency-Key": params.idempotencyKey,
  };
  if (params.userAccessToken) {
    headers.Authorization = `Bearer ${params.userAccessToken}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: params.email,
      workspace_id: params.workspaceId,
      use_case_id: params.useCaseId,
      workflow_id: params.workflowId,
      chat_id: params.chatId,
      selected_model_name: params.selectedModelName,
      output_type: params.outputType,
      workflow_output: params.workflowOutput,
      is_test_function: params.isTestFunction ?? false,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    log.error({ status: res.status, body: text.slice(0, 500) }, "workflow credits deduction failed");
  }
}

export type DeductTemplateVideoCreditsParams = {
  email: string;
  workspaceId: string;
  templateId: string;
  chatId: string;
  idempotencyKey: string;
  userAccessToken?: string;
};

export async function deductTemplateVideoCredits(
  params: DeductTemplateVideoCreditsParams,
): Promise<void> {
  const creditsBase = creditsBaseUrl();
  const apiKey = env.ASSET_MANAGER_SERVICE_AUTH_KEY ?? "";
  if (!creditsBase || !apiKey) {
    log.warn("missing credits base URL or ASSET_MANAGER_SERVICE_AUTH_KEY; skipping template video credits");
    return;
  }
  if (!params.email?.trim() || !params.workspaceId?.trim()) {
    log.warn("missing email/workspaceId; skipping template video credits");
    return;
  }
  const url = `${creditsBase}/credits/deduct-template-video-credits`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
    "Idempotency-Key": params.idempotencyKey,
  };
  if (params.userAccessToken) {
    headers.Authorization = `Bearer ${params.userAccessToken}`;
  }
  const res = await fetchWithTimeout(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: params.email,
      workspace_id: params.workspaceId,
      template_id: params.templateId,
      chat_id: params.chatId,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    log.error({ status: res.status, body: text.slice(0, 500) }, "template video credits deduction failed");
  }
}

export type DeductCreditsForConversationParams = {
  userId: string;
  workspaceId: string;
  totalTokens: number;
};

export type DeductCreditsForConversationResult = {
  message: string;
  success: boolean;
};

export async function deductCreditsForConversation(
  params: DeductCreditsForConversationParams,
): Promise<DeductCreditsForConversationResult> {
  const creditsBase = creditsBaseUrl();
  const apiKey = env.ASSET_MANAGER_SERVICE_AUTH_KEY ?? env.ASSET_MANAGER_SERVICE_API_KEY ?? "";
  if (!creditsBase || !apiKey) {
    log.warn(
      "missing CREDITS_BACKEND_BASE_URL/BACKEND_BASE_URL or ASSET_MANAGER_SERVICE_AUTH_KEY/ASSET_MANAGER_SERVICE_API_KEY; skipping conversation credits",
    );
    return { message: "Credits backend not configured", success: false };
  }
  if (!params.userId?.trim() || !params.workspaceId?.trim()) {
    log.warn("missing userId/workspaceId; skipping conversation credits deduction");
    return { message: "Missing userId or workspaceId", success: false };
  }
  const totalTokens = Math.max(0, Math.floor(params.totalTokens));
  if (totalTokens <= 0) {
    return { message: "No tokens to deduct", success: true };
  }

  const url = `${creditsBase}/credits/deduct-credits-for-conversation`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "x-api-key": apiKey,
  };

  log.info({ userId: params.userId, workspaceId: params.workspaceId, totalTokens }, "deducting conversation credits");
  try {
    const res = await fetchWithTimeout(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user_id: params.userId,
        workspace_id: params.workspaceId,
        total_tokens: totalTokens,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      log.error({ status: res.status, body: text.slice(0, 500) }, "conversation credits deduction failed");
      return { message: `Deduction failed (${res.status})`, success: false };
    }
    const body = (await res.json().catch(() => ({}))) as DeductCreditsForConversationResult;
    return { message: body.message ?? "OK", success: body.success ?? true };
  } catch (e) {
    log.error(
      { err: e, userId: params.userId, workspaceId: params.workspaceId, totalTokens },
      "conversation credits deduction request error",
    );
    return { message: "Request error", success: false };
  }
}

function resolveCreditCharge(options: NotifyPythonStoreGeneratedAssetsOptions): CreditDeductionCharge | null {
  if (options.creditDeduction && options.creditDeduction.quantity > 0) {
    return options.creditDeduction;
  }
  const legacy = options.billingImageCount ?? 0;
  if (legacy > 0) {
    return { serviceName: "image_gen", quantity: legacy };
  }
  return null;
}

async function maybeDeductCredits(options: NotifyPythonStoreGeneratedAssetsOptions): Promise<void> {
  const creditsBase = creditsBaseUrl();
  if (!creditsBase) return;

  const charge = resolveCreditCharge(options);
  if (!charge) return;

  const email = options.userEmail ?? "";
  const workspaceId = options.workspaceId ?? "";
  const messageId = options.messageId ?? "";
  const idempotencyKey = `${messageId}:${options.toolName}:${charge.serviceName}:q${charge.quantity}`;

  await deductCreditsByService({
    email,
    workspaceId,
    serviceName: charge.serviceName,
    quantity: charge.quantity,
    idempotencyKey,
    userAccessToken: options.userAccessToken,
    toolName: options.toolName,
    remarks: options.creditRemarks,
    executionSource: options.executionSource,
    jobName: options.jobName,
    agentJobId: options.jobId,
    agentJobRunId: options.runId,
  });
}

export type NotifyPythonStoreGeneratedAssetsOptions = {
  /** Chat thread id (interactive chat). */
  chatId?: string;
  /** AI message id for this turn (interactive chat). */
  messageId?: string;
  workspaceId?: string;
  toolName: string;
  /** Optional override for credit ledger remarks (rare; prefer backend defaults from toolName). */
  creditRemarks?: string;
  /** Scheduled agent job display name (ledger remarks when executionSource is scheduled_job). */
  jobName?: string;
  assetData: AssetItem[];
  /**
   * Preferred: explicit service + quantity (matches marketmint-pro-backend ServiceName + req_count).
   * If omitted, `billingImageCount` maps to `image_gen` × N for backward compatibility.
   */
  creditDeduction?: CreditDeductionCharge;
  /** @deprecated Prefer creditDeduction — maps to image_gen × N */
  billingImageCount?: number;
  userEmail?: string;
  userId?: string;
  userAccessToken?: string;
  executionSource?: string;
  jobId?: string;
  runId?: string;
  /** UI-only: multi-batch direct image gen (not sent to credits API). */
  taskGroupId?: string;
  batchIndex?: number;
  totalBatches?: number;
};

export async function notifyPythonStoreGeneratedAssets(
  options: NotifyPythonStoreGeneratedAssetsOptions,
): Promise<void> {
  const assetsBase = env.ASSETS_SERVICE_WEBHOOK_URL ?? "";
  const creditsBase = creditsBaseUrl();

  if (!assetsBase) {
    log.warn("ASSETS_SERVICE_WEBHOOK_URL not set, skipping assets store");
  }
  if (!creditsBase) {
    log.warn("CREDITS_BACKEND_BASE_URL not set, skipping credits");
  }
  if (!assetsBase && !creditsBase) {
    return;
  }

  const assetHeaders: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const assetManagerApiKey = env.ASSET_MANAGER_SERVICE_API_KEY ?? "";
  if (assetManagerApiKey) {
    assetHeaders["x-api-key-asset-manager-service"] = assetManagerApiKey;
  }
  if (!assetManagerApiKey && options.userAccessToken) {
    assetHeaders.Authorization = `Bearer ${options.userAccessToken}`;
  }

  const ref = resolveAssetReferencePayload({
    chatId: options.chatId,
    messageId: options.messageId,
    toolName: options.toolName,
    executionSource: options.executionSource,
    jobId: options.jobId,
    runId: options.runId,
  });

  // Asset POST and credits are independent: a failed/unreachable assets service must not skip billing.
  if (assetsBase) {
    try {
      if (!options.userAccessToken) {
        log.warn("no userAccessToken; assets POST /assets will likely return 401");
      }
      const assetsUrl = resolveAssetsPostUrl(assetsBase);
      const assetsRes = await fetchWithTimeout(assetsUrl, {
        method: "POST",
        headers: assetHeaders,
        body: JSON.stringify({
          referenceId: ref.referenceId,
          referenceType: ref.referenceType,
          referenceName: ref.referenceName,
          metadata: ref.metadata,
          email: options.userEmail ?? "",
          userId: options.userId ?? "",
          workspaceId: options.workspaceId ?? "",
          assets: options.assetData.map((a) => ({
            assetType: VALID_ASSET_TYPES.has(a.type) ? a.type : "image",
            assetId: a.id,
            mediaUrl: a.url,
            editType: "original",
            editParams: {},
            chunkData: {
              type: a.type,
              ...(a.metadata ? { metadata: a.metadata } : {}),
            },
          })),
        }),
      });
      if (!assetsRes.ok) {
        const text = await assetsRes.text();
        log.error({ status: assetsRes.status, body: text.slice(0, 500) }, "assets store failed");
      }
    } catch (e) {
      log.error({ err: e }, "assets store request error");
    }
  }

  try {
    await maybeDeductCredits(options);
  } catch (e) {
    log.error({ err: e }, "credits deduction request error");
  }
}
