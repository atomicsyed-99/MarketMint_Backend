/**
 * xAI Grok Imagine Video: start generation, poll until done, return video URL.
 * Mirrors Python app.services.grok_video_service (REST start + poll).
 */
const XAI_VIDEOS_BASE = "https://api.x.ai/v1/videos";
const GROK_MODEL = "grok-imagine-video";

import { fetchWithTimeout } from "@/lib/fetch";
import { env } from "@/env";

function getApiKey(): string {
  const key = env.XAI_API_KEY ?? "";
  if (!key) throw new Error("XAI_API_KEY must be set for Grok video generation");
  return key;
}

export async function startGrokVideo(params: {
  prompt: string;
  image_url?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
}): Promise<string> {
  const duration = Math.max(1, Math.min(15, params.duration ?? 5));
  const aspect_ratio = params.aspect_ratio ?? "16:9";
  const resolution = params.resolution ?? "480p";
  const payload: Record<string, unknown> = {
    model: GROK_MODEL,
    prompt: params.prompt,
    duration,
    aspect_ratio,
    resolution,
  };
  if (params.image_url) payload.image = { url: params.image_url };

  const res = await fetchWithTimeout(`${XAI_VIDEOS_BASE}/generations`, {
    timeoutMs: 60_000,
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Grok video start failed ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { request_id?: string };
  if (!data.request_id) throw new Error(`Grok API did not return request_id: ${JSON.stringify(data)}`);
  return data.request_id;
}

export async function getGrokVideoResult(requestId: string): Promise<{
  status: string;
  video_url: string | null;
  error: string | null;
}> {
  const res = await fetchWithTimeout(`${XAI_VIDEOS_BASE}/${requestId}`, {
    headers: { Authorization: `Bearer ${getApiKey()}` },
  });
  if (res.status !== 200 && res.status !== 202) {
    const text = await res.text();
    return { status: "failed", video_url: null, error: `Poll failed ${res.status}: ${text}` };
  }
  const data = (await res.json()) as { status?: string; video?: { url?: string } };
  const status = (data.status ?? "pending").toLowerCase();
  let video_url: string | null = null;
  if (status === "done" && data.video?.url) video_url = data.video.url;
  const error = status === "expired" ? "Request expired" : null;
  return { status, video_url, error };
}

export async function generateGrokVideo(params: {
  prompt: string;
  image_url?: string;
  duration?: number;
  aspect_ratio?: string;
  resolution?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}): Promise<{ video_url: string } | { error: string }> {
  const requestId = await startGrokVideo(params);
  const pollInterval = params.pollIntervalMs ?? 2000;
  const timeout = params.timeoutMs ?? 10 * 60 * 1000;
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await getGrokVideoResult(requestId);
    if (result.status === "done" && result.video_url) return { video_url: result.video_url };
    if (result.status === "failed" || result.status === "expired")
      return { error: result.error ?? "Video generation failed" };
    await new Promise((r) => setTimeout(r, pollInterval));
  }
  return { error: "Video generation timed out" };
}
