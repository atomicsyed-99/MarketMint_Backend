import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { buildPresentation, type SlideInput } from "@/lib/pptx-builder";
import { uploadArtifact, buildArtifactEventData, extractRequestContext, resolveArtifactMimeType } from "@/lib/artifact-upload";
import { emitUtility } from "@/mastra/tools/emit-utility";

const titleSlideSchema = z.object({
  layout: z.literal("title"),
  title: z.string().describe("Main title text"),
  subtitle: z.string().optional().describe("Subtitle text"),
});

const contentSlideSchema = z.object({
  layout: z.literal("content"),
  title: z.string().describe("Slide heading"),
  bullets: z.array(z.string()).min(1).max(8).describe("Bullet points (1-8 items)"),
  imageUrl: z.string().url().optional().describe("Optional image URL (from a previous directImageGen result). Displayed beside bullets."),
});

const imageSlideSchema = z.object({
  layout: z.literal("image"),
  title: z.string().describe("Slide heading"),
  imageUrl: z.string().url().describe("Image URL (from a previous directImageGen result). Displayed large."),
  caption: z.string().optional().describe("Image caption text"),
});

const columnContentSchema = z.object({
  bullets: z.array(z.string()).min(1).max(6),
  imageUrl: z.string().url().optional(),
});

const twoColumnSlideSchema = z.object({
  layout: z.literal("two-column"),
  title: z.string().describe("Slide heading"),
  leftContent: columnContentSchema,
  rightContent: columnContentSchema,
});

const comparisonSlideSchema = z.object({
  layout: z.literal("comparison"),
  title: z.string().describe("Slide heading"),
  leftHeader: z.string().describe("Left column header"),
  leftContent: columnContentSchema,
  rightHeader: z.string().describe("Right column header"),
  rightContent: columnContentSchema,
});

const slideSchema = z.discriminatedUnion("layout", [
  titleSlideSchema,
  contentSlideSchema,
  imageSlideSchema,
  twoColumnSlideSchema,
  comparisonSlideSchema,
]);

export const generatePresentation = createTool({
  id: "generatePresentation",
  description:
    "Generate a PowerPoint presentation (.pptx) from structured slide data. " +
    "Produces a downloadable PPTX file in standard 16:9 widescreen format. " +
    "To include AI-generated images, first call directImageGen, then pass the resulting image URLs here. " +
    "Available slide layouts: title (title + subtitle), content (heading + bullets + optional image), " +
    "image (heading + full image + caption), two-column (heading + two bullet columns), " +
    "comparison (heading + two labeled columns). " +
    "Start with a title slide. Aim for 5-15 slides for a good presentation.",
  inputSchema: z.object({
    title: z.string().describe("Presentation title (used for the file name and metadata)"),
    slides: z.array(slideSchema).min(1).max(30).describe("Ordered list of slides. Start with a title slide."),
    author: z.string().optional().describe("Author name for metadata"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    title: z.string(),
    url: z.string().optional(),
    slideCount: z.number(),
    message: z.string(),
    error: z.string().optional(),
    kind: z.literal("presentation").optional(),
    artifactId: z.string().optional(),
    metadata: z.object({
      filename: z.string(),
      mimeType: z.string(),
      slideCount: z.number().optional(),
    }).optional(),
  }),
  execute: async (input, context) => {
    const writer = context?.writer;
    const toolCallId = context?.agent?.toolCallId;
    const artifactId = toolCallId
      ? `artifact_${toolCallId}`
      : `artifact_${crypto.randomUUID().slice(0, 12)}`;
    const cardId = `pptx_${crypto.randomUUID().slice(0, 12)}`;

    emitUtility(context, {
      id: cardId,
      name: "generatePresentation",
      title: "Presentation Generation",
      category: "generation",
      status: "running",
      description: `Building ${input.slides.length}-slide presentation...`,
      steps: [
        { id: "build", title: "Building slides", status: "running" },
        { id: "upload", title: "Uploading file", status: "pending" },
      ],
    });

    // Always emit loading via writer.custom() so AI SDK adds it to message.parts[]
    await writer?.custom({
      type: "data-artifact",
      id: artifactId,
      data: buildArtifactEventData(artifactId, "presentation", "loading", input.title, {
        description: `${input.slides.length}-slide presentation`,
      }),
    });

    try {
      const startTime = Date.now();
      const buffer = await buildPresentation({
        title: input.title,
        slides: input.slides as SlideInput[],
        author: input.author,
      });
      const buildMs = Date.now() - startTime;

      emitUtility(context, {
        id: cardId,
        name: "generatePresentation",
        title: "Presentation Generation",
        category: "generation",
        status: "running",
        description: "Uploading presentation...",
        steps: [
          { id: "build", title: "Building slides", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "running" },
        ],
      });

      const reqCtx = extractRequestContext(context);
      const uploadResult = await uploadArtifact({
        title: input.title,
        kind: "presentation",
        content: buffer,
        metadata: {
          slideCount: input.slides.length,
          mimeType: resolveArtifactMimeType("presentation"),
        },
        ...reqCtx,
        toolName: "generatePresentation",
      });

      const totalMs = Date.now() - startTime;

      emitUtility(context, {
        id: cardId,
        name: "generatePresentation",
        title: "Presentation Generation",
        category: "generation",
        status: "completed",
        description: `${input.slides.length}-slide presentation ready`,
        duration_ms: totalMs,
        steps: [
          { id: "build", title: "Building slides", status: "completed", duration_ms: buildMs },
          { id: "upload", title: "Uploading file", status: "completed", duration_ms: totalMs - buildMs },
        ],
      });

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "presentation", "completed", input.title, {
          description: `${input.slides.length}-slide presentation`,
          url: uploadResult.url,
          metadata: {
            filename: uploadResult.filename,
            slideCount: input.slides.length,
            mimeType: resolveArtifactMimeType("presentation"),
          },
        }),
      });

      return {
        ok: true,
        title: input.title,
        url: uploadResult.url,
        slideCount: input.slides.length,
        message: `Presentation "${input.title}" (${input.slides.length} slides) generated and ready for download. Do NOT repeat the slide content.`,
        kind: "presentation" as const,
        artifactId,
        metadata: {
          filename: uploadResult.filename,
          mimeType: resolveArtifactMimeType("presentation"),
          slideCount: input.slides.length,
        },
      };
    } catch (err) {
      emitUtility(context, {
        id: cardId,
        name: "generatePresentation",
        title: "Presentation Generation",
        category: "generation",
        status: "failed",
        description: "Failed to generate presentation",
        error: err instanceof Error ? err.message : "Unknown error",
      });

      await writer?.custom({
        type: "data-artifact",
        id: artifactId,
        data: buildArtifactEventData(artifactId, "presentation", "failed", input.title, {
          description: "Failed to generate presentation",
        }),
      });

      return {
        ok: false,
        title: input.title,
        slideCount: 0,
        message: "",
        error: err instanceof Error ? err.message : "Failed to generate presentation",
        kind: "presentation" as const,
        artifactId,
      };
    }
  },
});
