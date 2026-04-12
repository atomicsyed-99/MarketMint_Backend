/**
 * After a scheduled agent job completes, re-scan serialized tool output and register
 * any image/video/artifact URLs with the Asset Manager. Uses job DB fields so storage
 * does not depend on tool-level RequestContext.
 */

import { createHash } from "node:crypto";
import type { AssetItem } from "@/lib/call-python-assets-credits";
import { notifyPythonStoreGeneratedAssets } from "@/lib/call-python-assets-credits";
import { createLogger } from "@/lib/logger";

const log = createLogger("agent-job-run-store-assets");

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object";
}

type ToolResultRow = { toolName: string; result: unknown; isError?: boolean };

function collectToolResultsFromDump(dumped: Record<string, unknown>): ToolResultRow[] {
  const out: ToolResultRow[] = [];
  const pushArr = (tr: unknown) => {
    if (!Array.isArray(tr)) return;
    for (const item of tr) {
      if (!isRecord(item)) continue;
      const payload = isRecord(item.payload) ? item.payload : item;
      const toolName = String(payload.toolName ?? item.toolName ?? "");
      if (!toolName) continue;
      const result = payload.result ?? item.result;
      const isError = Boolean(payload.isError ?? item.isError);
      out.push({ toolName, result, isError });
    }
  };
  pushArr(dumped.toolResults);
  const steps = dumped.steps;
  if (Array.isArray(steps)) {
    for (const step of steps) {
      if (isRecord(step)) pushArr(step.toolResults);
    }
  }
  return out;
}

function syntheticId(toolName: string, url: string, index: number): string {
  return `jobcap-${createHash("sha256").update(`${toolName}\n${url}\n${index}`).digest("hex").slice(0, 40)}`;
}

/** Same shape as execute-workflow's extractor; reads workflow Trigger result object. */
function extractWorkflowOutputAssets(result: Record<string, unknown>): AssetItem[] {
  const fromOutputAssets = Array.isArray(result.output_assets) ? result.output_assets : [];
  const fromWorkflowOutput = Array.isArray(result.workflow_output)
    ? result.workflow_output
    : [];
  const outputAssets = [...fromOutputAssets, ...fromWorkflowOutput];
  const assets: AssetItem[] = [];
  const seenUrls = new Set<string>();

  for (let i = 0; i < outputAssets.length; i++) {
    const item = outputAssets[i];
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const url = typeof rec.url === "string" ? rec.url : "";
    if (!url || seenUrls.has(url)) continue;
    seenUrls.add(url);
    const rawType =
      (typeof rec.output_type === "string" ? rec.output_type : "") ||
      (typeof rec.type === "string" ? rec.type : "");
    const outputType = rawType.toLowerCase();
    const type: "image" | "video" =
      outputType === "video" || /\.mp4($|\?)/i.test(url) ? "video" : "image";
    const meta =
      rec.metadata && typeof rec.metadata === "object"
        ? (rec.metadata as Record<string, unknown>)
        : null;
    const idFromMeta = meta && typeof meta.id === "string" && meta.id ? meta.id : "";
    const id =
      typeof rec.id === "string" && rec.id
        ? rec.id
        : idFromMeta || syntheticId("execute_workflow", url, i);
    assets.push({ url, id, type });
  }
  return assets;
}

function assetsFromToolRow(row: ToolResultRow, rowIndex: number): AssetItem[] {
  if (row.isError) return [];
  const { toolName, result } = row;
  if (!isRecord(result)) return [];
  if (result.status === "error" || result.ok === false) return [];

  switch (toolName) {
    case "directImageGen": {
      const images = result.images;
      if (!Array.isArray(images)) return [];
      return images.flatMap((img, i) => {
        if (!isRecord(img) || typeof img.url !== "string" || !img.url) return [];
        const id =
          typeof img.id === "string" && img.id
            ? img.id
            : syntheticId("directImageGen", img.url, rowIndex * 100 + i);
        return [{ url: img.url, id, type: "image" as const }];
      });
    }
    case "generateSingleImage": {
      const url = result.image_url;
      if (typeof url !== "string" || !url) return [];
      return [
        {
          url,
          id: syntheticId("generateSingleImage", url, rowIndex),
          type: "image",
        },
      ];
    }
    case "imageEdit": {
      const url = result.edited_image_url;
      if (typeof url !== "string" || !url) return [];
      return [
        {
          url,
          id: syntheticId("imageEdit", url, rowIndex),
          type: "image",
        },
      ];
    }
    case "generateVideoSingleShot":
    case "singleStepVideoGenerator": {
      const url = result.video_url;
      if (typeof url !== "string" || !url) return [];
      return [
        {
          url,
          id: syntheticId(toolName, url, rowIndex),
          type: "video",
        },
      ];
    }
    case "execute_workflow": {
      const inner = result.result;
      if (!isRecord(inner)) return [];
      return extractWorkflowOutputAssets(inner);
    }
    case "deliverContent":
    case "generatePresentation":
    case "generatePdf": {
      const url = result.url;
      if (typeof url !== "string" || !url) return [];
      const kind =
        typeof result.kind === "string" ? result.kind : toolName === "generatePdf" ? "pdf" : "markdown";
      const meta = isRecord(result.metadata) ? result.metadata : undefined;
      const filename =
        meta && typeof meta.filename === "string" ? meta.filename : `${toolName}-artifact`;
      const mimeType =
        meta && typeof meta.mimeType === "string" ? meta.mimeType : "application/octet-stream";
      const artifactId =
        typeof result.artifactId === "string" && result.artifactId
          ? result.artifactId
          : syntheticId(toolName, url, rowIndex);
      return [
        {
          url,
          id: artifactId,
          type: "artifact",
          metadata: {
            artifactKind: kind,
            filename,
            mimeType,
            sourceTool: toolName,
          },
        },
      ];
    }
    default:
      return [];
  }
}

/** Collect unique assets from a serialized Mastra generate() dump (toolResults + steps). */
export function extractAssetItemsFromJobDump(
  dumped: Record<string, unknown>,
): AssetItem[] {
  const rows = collectToolResultsFromDump(dumped);
  const byId = new Map<string, AssetItem>();

  rows.forEach((row, rowIndex) => {
    for (const item of assetsFromToolRow(row, rowIndex)) {
      if (!item.url?.startsWith("http")) continue;
      if (!byId.has(item.id)) byId.set(item.id, item);
    }
  });

  return [...byId.values()];
}

export type StoreJobRunAssetsParams = {
  dumped: Record<string, unknown>;
  workspaceId: string;
  userId: string;
  userEmail: string;
  jobId: string;
  runId: string;
  jobName: string;
};

/**
 * Register assets from tool outputs using job/run identity (scheduled job semantics).
 * Idempotent per asset id (service skips duplicate keys); synthetic ids are stable per URL+tool.
 */
export async function storeJobRunAssetsFromDump(
  params: StoreJobRunAssetsParams,
): Promise<void> {
  const assetData = extractAssetItemsFromJobDump(params.dumped);
  if (assetData.length === 0) return;

  await notifyPythonStoreGeneratedAssets({
    chatId: `scheduled-job:${params.jobId}`,
    messageId: `scheduled-run:${params.runId}`,
    workspaceId: params.workspaceId,
    toolName: "agentJobRunCapture",
    assetData,
    billingImageCount: 0,
    userEmail: params.userEmail,
    userId: params.userId,
    executionSource: "scheduled_job",
    jobId: params.jobId,
    runId: params.runId,
    jobName: params.jobName,
  });
  log.info(
    { jobId: params.jobId, runId: params.runId, count: assetData.length },
    "job run assets registered from dump",
  );
}
