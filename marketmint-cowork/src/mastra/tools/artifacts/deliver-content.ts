import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  uploadArtifact,
  buildArtifactEventData,
  canUseFallbackContent,
  resolveArtifactMimeType,
  extractRequestContext,
} from "@/lib/artifact-upload";
import { createLogger } from "@/lib/logger";
import { ARTIFACT_THRESHOLD, type ArtifactKind } from "@/types/artifacts";

const log = createLogger("deliver-content");

export const deliverContent = createTool({
  id: "deliverContent",
  description:
    "Present content deliverables to the user in the artifact panel. " +
    "Supports multiple content kinds: " +
    "markdown (emails, blog posts, landing page copy), " +
    "code (scripts, snippets — specify language), " +
    "json (structured data, API responses, configs), " +
    "csv (tabular data, exports, reports). " +
    "Content is uploaded to the asset service and rendered in the artifact panel with a download button. " +
    "Short markdown content (< 500 chars) renders inline. " +
    "Do NOT use for conversational responses — only for content the user will copy, download, or reuse.",
  inputSchema: z.object({
    title: z
      .string()
      .describe(
        'Title for the content (e.g., "Welcome Email Sequence", "Sales Data Q4")',
      ),
    content: z
      .string()
      .describe(
        "The full deliverable content. For markdown: use proper markdown formatting. " +
          "For code: the complete source code. For json: valid JSON string. " +
          "For csv: comma-separated values with header row.",
      ),
    kind: z
      .enum(["markdown", "code", "json", "csv"])
      .optional()
      .describe(
        'Content kind. "code" for source code, "json" for structured data, ' +
          '"csv" for tabular data, "markdown" (default) for documents and copy.',
      ),
    language: z
      .string()
      .optional()
      .describe(
        'Programming language (only for kind="code"). E.g., "python", "typescript", "sql".',
      ),
    display: z
      .enum(["auto", "artifact", "inline"])
      .optional()
      .describe(
        'How to display: "artifact" forces the full panel, "inline" forces a compact block in chat, ' +
          '"auto" (default) chooses based on content length. Only applies to markdown kind.',
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    kind: z.string(),
    display: z.string(),
    url: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
    description: z.string().optional(),
    artifactId: z.string().optional(),
    content: z.string().optional(),
    metadata: z.object({
      filename: z.string(),
      mimeType: z.string(),
      wordCount: z.number().optional(),
    }).optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const kind: ArtifactKind = input.kind ?? "markdown";
    // Use toolCallId for artifact ID so it matches the streaming deltas
    // emitted by the stream processor during AI SDK `c:` (tool_call_delta) events.
    const toolCallId = context?.agent?.toolCallId;
    const artifactId = toolCallId
      ? `artifact_${toolCallId}`
      : `artifact_${crypto.randomUUID().slice(0, 12)}`;

    // For markdown, preserve the existing inline vs artifact logic
    if (kind === "markdown") {
      const displayMode =
        input.display === "artifact"
          ? "artifact"
          : input.display === "inline"
            ? "inline"
            : input.content.length >= ARTIFACT_THRESHOLD
              ? "artifact"
              : "inline";

      if (displayMode === "inline") {
        const markdownId = `md_${crypto.randomUUID().slice(0, 12)}`;
        await writer?.custom({
          type: "data-markdown",
          id: markdownId,
          data: { id: markdownId, title: input.title, content: input.content },
        });
        return {
          ok: true,
          title: input.title,
          kind,
          display: "inline",
          message: `Content "${input.title}" delivered inline. Do NOT repeat the content.`,
          description: input.title,
        };
      }
    }

    // Always emit loading via writer.custom() so AI SDK adds it to message.parts[]
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: buildArtifactEventData(artifactId, kind, "loading", input.title, {
        description: input.title,
      }),
    });

    try {
      const reqCtx = extractRequestContext(context);
      const mimeType = resolveArtifactMimeType(kind);
      const csvRowCount =
        kind === "csv"
          ? input.content.split("\n").filter((l) => l.trim()).length - 1
          : undefined;
      const artifactMeta = {
        language: input.language,
        mimeType,
        ...(csvRowCount !== undefined ? { rowCount: csvRowCount } : {}),
      };

      // Upload to S3 + register with Asset Manager Service
      const uploadResult = await uploadArtifact({
        title: input.title,
        kind,
        content: input.content,
        metadata: artifactMeta,
        ...reqCtx,
        toolName: "deliverContent",
      });

      // Emit completed state with URL only (frontend fetches content from URL)
      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, kind, "completed", input.title, {
          description: input.title,
          url: uploadResult.url,
          metadata: {
            filename: uploadResult.filename,
            ...artifactMeta,
          },
        }),
      });

      return {
        ok: true,
        title: input.title,
        kind,
        display: "artifact",
        url: uploadResult.url,
        message: `Content "${input.title}" delivered as ${kind} artifact. Do NOT repeat the content in your response — the user can already see and copy it.`,
        description: input.title,
        artifactId,
        metadata: {
          filename: uploadResult.filename,
          mimeType,
          wordCount: kind === "markdown" ? input.content.split(/\s+/).filter(Boolean).length : undefined,
        },
      };
    } catch (err) {
      // Fallback: if S3 upload fails, emit content inline so user still sees something
      const fallback = canUseFallbackContent(input.content)
        ? input.content
        : undefined;

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(
          artifactId,
          kind,
          fallback ? "completed" : "failed",
          input.title,
          {
            description: input.title,
            content: fallback,
          },
        ),
      });

      log.error({ err }, "upload failed, fell back to inline");

      return {
        ok: fallback !== undefined,
        title: input.title,
        kind,
        display: "artifact",
        message: fallback
          ? `Content "${input.title}" delivered (upload failed, showing inline). Do NOT repeat the content.`
          : `Failed to deliver "${input.title}".`,
        error: err instanceof Error ? err.message : "Upload failed",
        description: input.title,
        artifactId,
        content: fallback,
      };
    }
  },
});
