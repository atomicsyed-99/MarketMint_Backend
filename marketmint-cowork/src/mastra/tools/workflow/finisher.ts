import { createTool } from "@mastra/core/tools";
import { z } from "zod";

function parseSuggestions(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-•*]/.test(line) || /^\d+[.)]/.test(line))
    .map((line) => line.replace(/^[-•*]\s*/, "").replace(/^\d+[.)]\s*/, ""))
    .map((line) => line.replace(/^\*\*(.+?)\*\*\s*[-–—:]*\s*/, "$1: "))
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export const finisherTool = createTool({
  id: "finisherTool",
  description:
    "Generate contextual follow-up suggestions. Pass what you just did AND the key topics/insights from your response so suggestions are relevant.",
  inputSchema: z.object({
    generated_content_summary: z
      .string()
      .describe("What was just accomplished (e.g. 'Generated 3 product images', 'Analyzed PostHog funnel data', 'Updated Shopify product descriptions')"),
    response_context: z
      .string()
      .describe("Key topics, insights, or data points from your response that the user might want to explore further (e.g. 'Showed bounce rate is 65% on mobile, top exit page is /checkout, funnel drop-off at step 2')"),
  }),
  outputSchema: z.object({
    suggestions: z.array(z.string()),
  }),
  execute: async (input, context) => {
    const finisherAgent = context?.mastra?.getAgent("finisherAgent");
    if (!finisherAgent) return { suggestions: [] };

    const stream = await finisherAgent.stream(
      `What was done: ${input.generated_content_summary}

Key context from the response: ${input.response_context}

Generate exactly 3-4 follow-up prompts the user would naturally want to ask next based on this context.`,
    );

    // Drain the stream silently so stream.text resolves — do NOT pipe to writer
    const reader = stream.fullStream.getReader();
    try {
      while (!(await reader.read()).done) {
        /* consume without forwarding */
      }
    } finally {
      reader.releaseLock();
    }

    const text = await stream.text;
    const suggestions = parseSuggestions(text);

    // data-suggestions custom event removed — frontend reads from tool-invocation.output
    return { suggestions };
  },
});

