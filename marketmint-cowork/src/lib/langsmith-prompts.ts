/**
 * Fetch template prompt content from LangSmith by name.
 * Mirrors Python app.ai.prompts.hub.PromptHub.get(): prompt_name = "{name}:{stage}", then pull_prompt.
 * Uses LangSmith REST API (pull prompt by name).
 */
import { env } from "@/env";
import { fetchWithTimeout } from "@/lib/fetch";
import { createLogger } from "@/lib/logger";

const log = createLogger("langsmith");

const STAGE = env.STAGE ?? "dev";
const LANGSMITH_API = env.LANGSMITH_ENDPOINT ?? "https://api.smith.langchain.com";

export async function getPromptContent(name: string): Promise<string> {
  const apiKey = env.LANGSMITH_API_KEY;
  if (!apiKey?.trim()) {
    return "";
  }
  const promptName = `${name.trim()}:${STAGE}`;
  try {
    const url = `${LANGSMITH_API.replace(/\/$/, "")}/api/v1/prompts/${encodeURIComponent(promptName)}/versions/latest`;
    const res = await fetchWithTimeout(url, {
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`LangSmith ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      prompt?: { template?: string };
      content?: string;
      messages?: Array<{ content?: string }>;
    };
    if (typeof data.content === "string") return data.content;
    if (data.prompt?.template) return data.prompt.template;
    if (Array.isArray(data.messages) && data.messages[0]?.content) return data.messages[0].content;
    return String(data ?? "");
  } catch (e) {
    log.warn({ err: e }, "fetch failed");
    throw new Error(`Failed to fetch template prompt ${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
