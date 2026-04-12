import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { buildPdf, type PdfSection } from "@/lib/pdf-builder";
import { uploadArtifact, buildArtifactEventData, extractRequestContext, resolveArtifactMimeType } from "@/lib/artifact-upload";
import { emitUtility } from "@/mastra/tools/emit-utility";

// ── Zod Schemas for PDF Sections ─────────────────────────────────────

const textSectionSchema = z.object({
  type: z.literal("text"),
  content: z.string().describe("Paragraph text"),
});

const headingSectionSchema = z.object({
  type: z.literal("heading"),
  content: z.string().describe("Heading text"),
  level: z
    .union([z.literal(1), z.literal(2), z.literal(3)])
    .optional()
    .describe("Heading level: 1 (largest), 2, or 3 (smallest). Default: 1."),
});

const bulletSectionSchema = z.object({
  type: z.literal("bullets"),
  items: z
    .array(z.string())
    .min(1)
    .max(20)
    .describe("Bullet point items"),
});

const imageSectionSchema = z.object({
  type: z.literal("image"),
  url: z
    .string()
    .url()
    .describe("Image URL (from a previous directImageGen result)"),
  caption: z.string().optional().describe("Image caption"),
  width: z.number().optional().describe("Image width in points. Default: full content width."),
});

const tableSectionSchema = z.object({
  type: z.literal("table"),
  headers: z.array(z.string()).min(1).max(8).describe("Column headers"),
  rows: z
    .array(z.array(z.string()))
    .min(1)
    .max(50)
    .describe("Table rows (array of arrays). Each row must have the same number of columns as headers."),
});

const dividerSectionSchema = z.object({
  type: z.literal("divider"),
});

const sectionSchema = z.discriminatedUnion("type", [
  textSectionSchema,
  headingSectionSchema,
  bulletSectionSchema,
  imageSectionSchema,
  tableSectionSchema,
  dividerSectionSchema,
]);

// ── Tool Definition ──────────────────────────────────────────────────

export const generatePdf = createTool({
  id: "generatePdf",
  description:
    "Generate a PDF document from structured content sections. " +
    "Produces a downloadable PDF file in A4 format with a title page. " +
    "Use ONLY when the user explicitly asks for a PDF — never generate PDFs proactively. " +
    "Available section types: heading (h1/h2/h3), text (paragraph), bullets (list), " +
    "image (from URL with optional caption), table (headers + rows), divider (horizontal line). " +
    "To include AI-generated images, first call directImageGen, then pass the resulting URLs here.",
  inputSchema: z.object({
    title: z.string().describe("Document title (shown on title page and used for filename)"),
    subtitle: z.string().optional().describe("Document subtitle (shown on title page)"),
    author: z.string().optional().describe("Author name (shown on title page and in PDF metadata)"),
    sections: z
      .array(sectionSchema)
      .min(1)
      .max(100)
      .describe("Ordered list of content sections that make up the document body."),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    url: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
    kind: z.literal("pdf").optional(),
    artifactId: z.string().optional(),
    metadata: z.object({
      filename: z.string(),
      mimeType: z.string(),
      pageCount: z.number().optional(),
    }).optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const toolCallId = context?.agent?.toolCallId;
    const artifactId = toolCallId
      ? `artifact_${toolCallId}`
      : `artifact_${crypto.randomUUID().slice(0, 12)}`;
    const cardId = `pdf_${crypto.randomUUID().slice(0, 12)}`;

    emitUtility(context, {
      id: cardId,
      name: "generatePdf",
      title: "PDF Generation",
      category: "generation",
      status: "running",
      description: `Building PDF document...`,
      steps: [
        { id: "build", title: "Building PDF", status: "running" },
        { id: "upload", title: "Uploading file", status: "pending" },
      ],
    });

    // Always emit loading via writer.custom() so AI SDK adds it to message.parts[]
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: buildArtifactEventData(artifactId, "pdf", "loading", input.title, {
        description: "Generating PDF document",
      }),
    });

    try {
      const startTime = Date.now();
      const { buffer, pageCount } = await buildPdf({
        title: input.title,
        subtitle: input.subtitle,
        author: input.author,
        sections: input.sections as PdfSection[],
      });
      const buildMs = Date.now() - startTime;

      emitUtility(context, {
        id: cardId,
        name: "generatePdf",
        title: "PDF Generation",
        category: "generation",
        status: "running",
        description: "Uploading PDF...",
        steps: [
          { id: "build", title: "Building PDF", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "running" },
        ],
      });

      const reqCtx = extractRequestContext(context);
      const uploadResult = await uploadArtifact({
        title: input.title,
        kind: "pdf",
        content: buffer,
        metadata: {
          mimeType: resolveArtifactMimeType("pdf"),
          pageCount,
        },
        ...reqCtx,
        toolName: "generatePdf",
      });

      const totalMs = Date.now() - startTime;

      emitUtility(context, {
        id: cardId,
        name: "generatePdf",
        title: "PDF Generation",
        category: "generation",
        status: "completed",
        description: "PDF document ready",
        duration_ms: totalMs,
        steps: [
          { id: "build", title: "Building PDF", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "completed", duration_ms: totalMs - buildMs },
        ],
      });

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "pdf", "completed", input.title, {
          description: "PDF document",
          url: uploadResult.url,
          metadata: {
            filename: uploadResult.filename,
            mimeType: resolveArtifactMimeType("pdf"),
            pageCount,
          },
        }),
      });

      return {
        ok: true,
        title: input.title,
        url: uploadResult.url,
        message: `PDF "${input.title}" generated and ready for download. Do NOT repeat the document content.`,
        kind: "pdf" as const,
        artifactId,
        metadata: {
          filename: uploadResult.filename,
          mimeType: resolveArtifactMimeType("pdf"),
          pageCount,
        },
      };
    } catch (err) {
      emitUtility(context, {
        id: cardId,
        name: "generatePdf",
        title: "PDF Generation",
        category: "generation",
        status: "failed",
        description: "Failed to generate PDF",
        error: err instanceof Error ? err.message : "Unknown error",
      });

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "pdf", "failed", input.title, {
          description: "Failed to generate PDF",
        }),
      });

      return {
        ok: false,
        title: input.title,
        message: "",
        error: err instanceof Error ? err.message : "Failed to generate PDF",
        kind: "pdf" as const,
        artifactId,
      };
    }
  },
});
