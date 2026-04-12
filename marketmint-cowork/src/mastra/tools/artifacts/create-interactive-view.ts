import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { AVAILABLE_MODULES } from "@/lib/guidelines";
import { uploadArtifact, extractRequestContext } from "@/lib/artifact-upload";
import { createLogger } from "@/lib/logger";

const log = createLogger("create-interactive-view");

const DEFAULT_MODULE = "mockup";

export const createInteractiveView = createTool({
  id: "createInteractiveView",
  description:
    "Render a rich visual widget (dashboard, chart, data table, diagram) in the artifact panel. " +
    "The widget is displayed in a sandboxed iframe with full CSS/JS support including CDN libraries like Chart.js. " +
    "You MUST call readGuidelines first to load the design system before using this tool. " +
    "Structure your HTML as: <style> block → HTML content → <script> tags (this order is critical for streaming). " +
    "Output HTML fragments only — no DOCTYPE, <html>, <head>, or <body> tags. " +
    "CDN allowlist: cdn.jsdelivr.net, cdnjs.cloudflare.com, unpkg.com, esm.sh.",
  inputSchema: z.object({
    has_read_guidelines: z
      .boolean()
      .describe(
        "Confirm you have called readGuidelines in this conversation. Must be true."
      ),
    title: z
      .string()
      .describe(
        'Human-readable title for the widget (e.g., "Revenue Dashboard")'
      ),
    description: z
      .string()
      .describe("One-line description of what this widget shows"),
    widget_code: z
      .string()
      .describe(
        "HTML fragment to render. Structure: <style> → HTML → <script>. No DOCTYPE/<html>/<head>/<body>."
      ),
    width: z
      .number()
      .optional()
      .describe("Widget width in pixels. Default: 900."),
    height: z
      .number()
      .optional()
      .describe("Widget height in pixels. Default: 600."),
    module_type: z
      .enum(AVAILABLE_MODULES)
      .optional()
      .describe("Primary module type used."),
    data_sources: z
      .array(z.string())
      .optional()
      .describe(
        'Integration names that provided the data (e.g., ["Shopify"])'
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    artifactId: z.string().optional(),
    kind: z.literal("html").optional(),
    widget: z.object({
      widget_code: z.string(),
      width: z.number(),
      height: z.number(),
      module_type: z.string(),
      data_sources: z.array(z.string()),
    }).optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async (input, context) => {
    // Use toolCallId for artifact ID so it matches the early loading skeleton
    // emitted by the stream processor when the AI SDK `b:` (tool_call_streaming_start) line fires.
    // Mastra nests toolCallId under context.agent, not top-level context.
    const toolCallId = context?.agent?.toolCallId;
    const artifactId = toolCallId
      ? `artifact_${toolCallId}`
      : `artifact_${crypto.randomUUID().slice(0, 12)}`;
    const writer = context?.writer;
    const moduleType = input.module_type ?? DEFAULT_MODULE;

    // WHY: soft guard — nudges the LLM to call readGuidelines first; not server-enforced
    if (!input.has_read_guidelines) {
      return {
        ok: false,
        title: "",
        message: "",
        error:
          "You must call readGuidelines before createInteractiveView. Load the design system first.",
      };
    }

    // Emit loading → completed via writer.custom(). Each call is wrapped
    // individually so a writer failure (e.g. stream closed) doesn't prevent
    // the tool from returning success — the widget_code is already generated.
    const emitSafe = async (data: Record<string, unknown>) => {
      try {
        await writer?.custom(data);
      } catch (err) {
        log.warn({ err, artifactId }, "writer.custom failed (non-fatal)");
      }
    };

    await emitSafe({
      type: "data-artifact",
      id: artifactId,
      data: {
        id: artifactId,
        kind: "html",
        status: "loading",
        title: input.title,
        description: input.description,
        module_type: moduleType,
        data_sources: input.data_sources ?? [],
      },
    });

    await emitSafe({
      type: "data-artifact",
      id: artifactId,
      data: {
        id: artifactId,
        kind: "html",
        status: "completed",
        title: input.title,
        description: input.description,
        widget: {
          widget_code: input.widget_code,
          width: input.width ?? 900,
          height: input.height ?? 600,
          module_type: moduleType,
          data_sources: input.data_sources ?? [],
        },
      },
    });

    // Upload HTML to S3 for download (non-blocking, doesn't delay widget rendering)
    const reqCtx = extractRequestContext(context);
    uploadArtifact({
      title: input.title,
      kind: "html",
      content: input.widget_code,
      ...reqCtx,
      toolName: "createInteractiveView",
    }).catch((err) => {
      log.warn({ err }, "S3 upload failed (non-blocking)");
    });

    // Return success WITHOUT widget_code — the LLM doesn't need 10K+ tokens
    // of HTML echoed back. The frontend gets widget data via the data-artifact
    // custom event above. Only return metadata for LLM context.
    return {
      ok: true,
      title: input.title,
      artifactId,
      kind: "html" as const,
      widget: {
        widget_code: "(rendered in artifact panel)",
        width: input.width ?? 900,
        height: input.height ?? 600,
        module_type: moduleType,
        data_sources: input.data_sources ?? [],
      },
      message: `Widget "${input.title}" rendered in artifact panel. Do NOT repeat the HTML code. The dashboard is an ADDITION to your response — you MUST still answer the user's question with your analysis, key findings, and insights in plain text. The widget visualizes the data; your text explains what it means.`,
    };
  },
});
