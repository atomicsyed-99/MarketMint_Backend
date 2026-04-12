import { env } from "@/env";

type TriggerDevConfig = {
  taskId: string;
  streamKey: string;
};

const TRIGGER_DEV_USE_CASE_CONFIG: Record<string, TriggerDevConfig> = {
  garments_v2_lifestyle: {
    taskId: "garments-v2-workflow",
    streamKey: "garments-v2-events",
  },
  garments_v2_studio: {
    taskId: "garments-v2-workflow",
    streamKey: "garments-v2-events",
  },
  hero_campaign_banner: {
    taskId: "social-static-ad-workflow",
    streamKey: "social-static-ad-events",
  },
  jewellery_photoshoot: {
    taskId: "accessories-shoot-workflow",
    streamKey: "accessories-shoot-events",
  },
  non_garment_in_studio_background: {
    taskId: "non-garment-shoot-workflow",
    streamKey: "non-garment-shoot-events",
  },
  non_garment_in_lifestyle_scene: {
    taskId: "non-garment-shoot-workflow",
    streamKey: "non-garment-shoot-events",
  },
  fabric_material_close_up: {
    taskId: "product-closeup-workflow",
    streamKey: "product-closeup-events",
  },
  creative_video_generator: {
    taskId: "video-workflow",
    streamKey: "video-events",
  },
  static_social_ad_creative: {
    taskId: "social-static-ad-workflow",
    streamKey: "social-static-ad-events",
  },
  infographic_module: {
    taskId: "product-listing-workflow",
    streamKey: "product-listing-events",
  },
  feature_highlight_graphic: {
    taskId: "product-listing-workflow",
    streamKey: "product-listing-events",
  },
  multi_product_try_on: {
    taskId: "multi-product-visuals-workflow",
    streamKey: "multi-product-visuals-events",
  },
  replace_background: {
    taskId: "image-edit-workflow",
    streamKey: "image-edit-events",
  },
  sketch_to_product: {
    taskId: "sketch-to-product-workflow",
    streamKey: "sketch-to-product-events",
  },
  product_swap_or_try_on: {
    taskId: "product-swap-workflow",
    streamKey: "product-swap-events",
  },
};

function buildGarmentsV2TriggerPayload(options: {
  workflowId: string;
  useCaseId: string;
  workflowInputs: Record<string, any>;
  chatId?: string;
}) {
  const { workflowId, useCaseId, workflowInputs, chatId } = options;
  const wi: Record<string, any> = { ...(workflowInputs || {}) };

  const garmentImages = wi.garment_images || [];
  const normalizedGarments: string[] = [];
  for (const g of garmentImages) {
    if (g && typeof g === "object") {
      const url = g.url || g.image_url || g.value;
      if (url) normalizedGarments.push(url);
    } else if (typeof g === "string") {
      normalizedGarments.push(g);
    }
  }
  wi.garment_images = normalizedGarments;

  let modelImages = wi.model_images || [];
  const singleModel = wi.model_image;
  if (singleModel) {
    const url =
      typeof singleModel === "object"
        ? singleModel.url || singleModel.image_url || singleModel.value
        : singleModel;
    if (url) {
      modelImages = modelImages || [];
      if (!modelImages.includes(url)) modelImages.push(url);
    }
  }
  if (modelImages && modelImages.length > 0) {
    wi.model_images = modelImages;
  }

  let backgroundImages = wi.background_images || [];
  const singleBg = wi.background_image;
  if (singleBg) {
    const url =
      typeof singleBg === "object"
        ? singleBg.url || singleBg.image_url || singleBg.value
        : singleBg;
    if (url) {
      backgroundImages = backgroundImages || [];
      if (!backgroundImages.includes(url)) backgroundImages.push(url);
    }
  }
  if (backgroundImages && backgroundImages.length > 0) {
    wi.background_images = backgroundImages;
  }

  if (wi.poses == null) {
    wi.poses = [];
  }

  const jobId = crypto.randomUUID();
  const normalizedChatId = chatId ? String(chatId) : null;

  return {
    payload: {
      job_id: jobId,
      workflow_id: workflowId || "garments_v2",
      workflow_input: wi,
      usecase: useCaseId,
      is_batch: false,
      metadata: {},
    },
    options: {
      priority: 86400,
      tags: [normalizedChatId, "cowork"],
    },
  };
}

function buildDefaultTriggerPayload(options: {
  workflowId: string;
  useCaseId: string;
  workflowInputs: Record<string, any>;
  chatId?: string;
}) {
  const { useCaseId, workflowInputs, chatId } = options;
  const normalizedChatId = chatId ? String(chatId) : null;
  return {
    payload: {
      usecase: useCaseId,
      workflow_input: workflowInputs,
    },
    options: {
      priority: 86400,
      tags: [normalizedChatId, "cowork"],
    },
  };
}

/**
 * Payload shape expected by `non-garment-shoot-workflow` (matches Trigger management / Python execute contract):
 * `job_id`, `workflow_id`, nested `workflow_input.usecase`, root `usecase` (router id), `resume`, etc.
 * Root `usecase` differs from `workflow_input.usecase` for routing (per Trigger / execute pipeline contract).
 */
const NON_GARMENT_SHOOT_ROOT_USECASE: Record<string, string> = {
  non_garment_in_lifestyle_scene: "non_garment_shoot_lifestyle",
  non_garment_in_studio_background: "non_garment_shoot_studio",
};

function buildNonGarmentShootTriggerPayload(options: {
  workflowId: string;
  useCaseId: string;
  workflowInputs: Record<string, any>;
  chatId?: string;
}) {
  const { workflowId, useCaseId, workflowInputs, chatId } = options;
  const normalizedChatId = chatId ? String(chatId) : null;
  const jobId = crypto.randomUUID();

  const wi: Record<string, any> = { ...(workflowInputs || {}) };
  wi.usecase = useCaseId;

  if (!("template_id" in wi)) wi.template_id = null;
  if (!("moodboard_id" in wi)) wi.moodboard_id = null;
  if (!("template_metadata" in wi)) wi.template_metadata = null;

  const rootUsecase =
    NON_GARMENT_SHOOT_ROOT_USECASE[useCaseId] ?? useCaseId;

  return {
    payload: {
      job_id: jobId,
      workflow_id: workflowId || "non_garment_shoot",
      workflow_input: wi,
      metadata: {},
      message_id: null,
      resume: false,
      usecase: rootUsecase,
    },
    options: {
      priority: 86400,
      tags: [normalizedChatId, "cowork"],
    },
  };
}

async function triggerRun(taskId: string, payload: Record<string, any>): Promise<string> {
  const baseUrl = "https://api.trigger.dev";
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/tasks/${taskId}/trigger`;
  const token = env.SPACES_TRIGGER_SECRET_KEY
  if (!token) {
    throw new Error("SPACES_TRIGGER_SECRET_KEY is not configured");
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const branch = (env.TRIGGER_PREVIEW_BRANCH || "").trim();
  if (branch) {
    headers["x-trigger-branch"] = branch;
  }

  const resp = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
  });
  const bodyText = await resp.text();
  if (!resp.ok) {
    throw new Error(
      `Trigger.dev trigger failed: status=${resp.status} body=${bodyText.slice(0, 500)}`,
    );
  }
  const data = JSON.parse(bodyText);
  const runId = data.id as string | undefined;
  if (!runId) {
    throw new Error(`Trigger.dev response missing run ID: ${bodyText}`);
  }
  return runId;
}

async function* streamEvents(
  runId: string,
  streamKey: string,
): AsyncGenerator<Record<string, any>, void, unknown> {
  const baseUrl = "https://api.trigger.dev";
  const url = `${baseUrl.replace(/\/$/, "")}/realtime/v1/streams/${runId}/${streamKey}`;
  const token = env.SPACES_TRIGGER_SECRET_KEY;
  if (!token) {
    throw new Error("SPACES_TRIGGER_SECRET_KEY is not configured");
  }

  const timeoutSeconds = 600;
  const branch = (env.TRIGGER_PREVIEW_BRANCH || "").trim();
  let lastEventId: string | undefined;
  const maxRetries = 5;
  let attempt = 0;

  while (attempt < maxRetries) {
    const headers: Record<string, string> = {
      Accept: "text/event-stream",
      Authorization: `Bearer ${token}`,
      "Timeout-Seconds": String(timeoutSeconds),
    };
    if (branch) headers["x-trigger-branch"] = branch;
    if (lastEventId) headers["Last-Event-ID"] = lastEventId;

    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok || !resp.body) {
        const bodyText = await resp.text();
        throw new Error(
          `Trigger.dev stream failed: status=${resp.status} body=${bodyText.slice(0, 500)}`,
        );
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder("utf-8");
      let buffer = "";
      let currentEventId: string | undefined;
      let dataLines: string[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).trimEnd();
          buffer = buffer.slice(newlineIndex + 1);

          if (!line) {
            for (const dataStr of dataLines) {
              if (!dataStr || dataStr === "[DONE]") continue;
              try {
                let obj: unknown = JSON.parse(dataStr);
                if (typeof obj === "string") obj = JSON.parse(obj);
                if (obj && typeof obj === "object") {
                  if (currentEventId) lastEventId = currentEventId;
                  const event = obj as Record<string, any>;
                  yield event;
                  const typ = event.type;
                  if (typ === "complete" || typ === "disconnected") {
                    return;
                  }
                }
              } catch {
                yield { raw: dataStr };
              }
            }
            dataLines = [];
            currentEventId = undefined;
            continue;
          }

          if (line.startsWith("id:")) {
            currentEventId = line.slice(3).trim() || undefined;
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
      }

      // stream ended without terminal event; retry
      attempt += 1;
      if (attempt >= maxRetries) return;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    } catch (error) {
      attempt += 1;
      if (attempt >= maxRetries) throw error;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
}

export async function runWorkflowAndStream(options: {
  workflowId: string;
  useCaseId: string;
  workflowInputs: Record<string, any>;
  chatId?: string;
  onEvent: (event: any) => Promise<void> | void;
  onRunStarted?: (runId: string) => Promise<void> | void;
}): Promise<{ result: Record<string, any> }> {
  const { workflowId, useCaseId, workflowInputs, chatId, onEvent, onRunStarted } = options;
  const cfg = TRIGGER_DEV_USE_CASE_CONFIG[useCaseId];
  if (!cfg) {
    throw new Error(`Unsupported use_case_id for Trigger.dev: ${useCaseId}`);
  }

  const payload =
    useCaseId === "garments_v2_lifestyle" ||
    useCaseId === "garments_v2_studio"
      ? buildGarmentsV2TriggerPayload({
          workflowId,
          useCaseId,
          workflowInputs,
          chatId,
        })
      : useCaseId === "non_garment_in_lifestyle_scene" ||
          useCaseId === "non_garment_in_studio_background"
        ? buildNonGarmentShootTriggerPayload({
            workflowId,
            useCaseId,
            workflowInputs,
            chatId,
          })
        : buildDefaultTriggerPayload({
            workflowId,
            useCaseId,
            workflowInputs,
            chatId,
          });

  const runId = await triggerRun(cfg.taskId, payload);
  if (onRunStarted) {
    await onRunStarted(runId);
  }

  let finalOutput: Record<string, any> = {};
  for await (const event of streamEvents(runId, cfg.streamKey)) {
    try {
      await onEvent(event);
    } catch {
    }
    const type = (event as any).type;
    if (type === "complete") {
      const output = (event as any).output ?? (event as any).result ?? {};
      finalOutput =
        output && typeof output === "object"
          ? (output as Record<string, any>)
          : { raw_output: output };
    }
    if (type === "disconnected") {
      break;
    }
  }

  return { result: finalOutput };
}


