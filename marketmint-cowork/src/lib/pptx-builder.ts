import PptxGenJS from "pptxgenjs";
import { createLogger } from "@/lib/logger";
import { safeFetchImage } from "@/lib/url-safety";

const log = createLogger("pptx-builder");

// ── Slide Layout Types ──────────────────────────────────────────────

interface TitleSlide {
  layout: "title";
  title: string;
  subtitle?: string;
}

interface ContentSlide {
  layout: "content";
  title: string;
  bullets: string[];
  imageUrl?: string;
}

interface ImageSlide {
  layout: "image";
  title: string;
  imageUrl: string;
  caption?: string;
}

interface ColumnContent {
  bullets: string[];
  imageUrl?: string;
}

interface TwoColumnSlide {
  layout: "two-column";
  title: string;
  leftContent: ColumnContent;
  rightContent: ColumnContent;
}

interface ComparisonSlide {
  layout: "comparison";
  title: string;
  leftHeader: string;
  leftContent: ColumnContent;
  rightHeader: string;
  rightContent: ColumnContent;
}

export type SlideInput =
  | TitleSlide
  | ContentSlide
  | ImageSlide
  | TwoColumnSlide
  | ComparisonSlide;

export interface PresentationInput {
  title: string;
  slides: SlideInput[];
  author?: string;
}

// ── Theme Constants ──────────────────────────────────────────────────

const COLORS = {
  primary: "1A1A2E",
  accent: "E94560",
  textDark: "1A1A2E",
  textLight: "FFFFFF",
  bgLight: "F5F5F5",
  bgDark: "16213E",
  subtle: "6B7280",
  divider: "E5E7EB",
} as const;

const FONTS = {
  heading: "Helvetica",
  body: "Helvetica",
} as const;

// ── Safe Image Helper ────────────────────────────────────────────────

function renderImagePlaceholder(
  slide: any,
  opts: { x: number; y: number; w: number; h: number },
  message: string,
): void {
  slide.addShape("rect" as any, {
    x: opts.x, y: opts.y, w: opts.w, h: opts.h,
    fill: { color: COLORS.bgLight },
    line: { color: COLORS.divider, width: 1 },
  });
  slide.addText(message, {
    x: opts.x, y: opts.y + opts.h / 2 - 0.2, w: opts.w, h: 0.4,
    fontSize: 11, fontFace: FONTS.body, color: COLORS.subtle,
    align: "center", italic: true,
  });
}

/** Add a pre-fetched image to a slide, with placeholder fallback. */
function addImageFromCache(
  slide: any,
  opts: { path: string; x: number; y: number; w: number; h: number; sizing?: any },
  imageCache: Map<string, Buffer | null>,
): void {
  const imageBuffer = imageCache.get(opts.path);
  if (!imageBuffer) {
    renderImagePlaceholder(slide, opts, "[Image unavailable]");
    return;
  }

  try {
    const base64 = imageBuffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    slide.addImage({ ...opts, path: dataUrl });
  } catch (err) {
    log.warn({ err, path: opts.path }, "failed to add image, using placeholder");
    renderImagePlaceholder(slide, opts, "[Image unavailable]");
  }
}

/** Collect all unique image URLs from slides for parallel prefetch. */
function collectImageUrls(slides: SlideInput[]): string[] {
  const urls = new Set<string>();
  for (const slide of slides) {
    if ("imageUrl" in slide && slide.imageUrl) urls.add(slide.imageUrl);
    if ("leftContent" in slide && slide.leftContent?.imageUrl) urls.add(slide.leftContent.imageUrl);
    if ("rightContent" in slide && slide.rightContent?.imageUrl) urls.add(slide.rightContent.imageUrl);
  }
  return Array.from(urls);
}

// ── Slide Renderers ──────────────────────────────────────────────────

function renderTitleSlide(pptx: PptxGenJS, slide: TitleSlide, _imageCache: Map<string, Buffer | null>): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bgDark };
  s.addText(slide.title, {
    x: 0.8, y: 2.0, w: 8.4, h: 1.5,
    fontSize: 40, fontFace: FONTS.heading, color: COLORS.textLight, bold: true, align: "left",
  });
  if (slide.subtitle) {
    s.addText(slide.subtitle, {
      x: 0.8, y: 3.6, w: 8.4, h: 0.8,
      fontSize: 20, fontFace: FONTS.body, color: COLORS.accent, align: "left",
    });
  }
  s.addShape("rect" as any, {
    x: 0.8, y: 3.3, w: 2.0, h: 0.05, fill: { color: COLORS.accent },
  });
}

function renderContentSlide(pptx: PptxGenJS, slide: ContentSlide, imageCache: Map<string, Buffer | null>): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };
  s.addText(slide.title, {
    x: 0.8, y: 0.3, w: 8.4, h: 0.8,
    fontSize: 28, fontFace: FONTS.heading, color: COLORS.textDark, bold: true,
  });
  s.addShape("rect" as any, {
    x: 0.8, y: 1.1, w: 8.4, h: 0.02, fill: { color: COLORS.divider },
  });
  const contentWidth = slide.imageUrl ? 5.0 : 8.4;
  const bulletItems = slide.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 16, fontFace: FONTS.body, color: COLORS.textDark, paraSpaceAfter: 8,
    },
  }));
  s.addText(bulletItems as any, {
    x: 0.8, y: 1.4, w: contentWidth, h: 5.0, valign: "top",
  });
  if (slide.imageUrl) {
    addImageFromCache(s, {
      path: slide.imageUrl, x: 6.2, y: 1.4, w: 3.4, h: 5.0,
      sizing: { type: "contain", w: 3.4, h: 5.0 },
    }, imageCache);
  }
}

function renderImageSlide(pptx: PptxGenJS, slide: ImageSlide, imageCache: Map<string, Buffer | null>): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.bgLight };
  s.addText(slide.title, {
    x: 0.8, y: 0.3, w: 8.4, h: 0.7,
    fontSize: 24, fontFace: FONTS.heading, color: COLORS.textDark, bold: true,
  });
  addImageFromCache(s, {
    path: slide.imageUrl, x: 0.8, y: 1.2, w: 8.4, h: 5.0,
    sizing: { type: "contain", w: 8.4, h: 5.0 },
  }, imageCache);
  if (slide.caption) {
    s.addText(slide.caption, {
      x: 0.8, y: 6.4, w: 8.4, h: 0.5,
      fontSize: 12, fontFace: FONTS.body, color: COLORS.subtle, align: "center", italic: true,
    });
  }
}

function renderTwoColumnSlide(pptx: PptxGenJS, slide: TwoColumnSlide, _imageCache: Map<string, Buffer | null>): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };
  s.addText(slide.title, {
    x: 0.8, y: 0.3, w: 8.4, h: 0.8,
    fontSize: 28, fontFace: FONTS.heading, color: COLORS.textDark, bold: true,
  });
  s.addShape("rect" as any, {
    x: 0.8, y: 1.1, w: 8.4, h: 0.02, fill: { color: COLORS.divider },
  });
  const leftBullets = slide.leftContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14, fontFace: FONTS.body, color: COLORS.textDark, paraSpaceAfter: 6,
    },
  }));
  s.addText(leftBullets as any, { x: 0.8, y: 1.4, w: 4.0, h: 5.0, valign: "top" });
  s.addShape("rect" as any, {
    x: 4.95, y: 1.4, w: 0.02, h: 5.0, fill: { color: COLORS.divider },
  });
  const rightBullets = slide.rightContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14, fontFace: FONTS.body, color: COLORS.textDark, paraSpaceAfter: 6,
    },
  }));
  s.addText(rightBullets as any, { x: 5.2, y: 1.4, w: 4.0, h: 5.0, valign: "top" });
}

function renderComparisonSlide(pptx: PptxGenJS, slide: ComparisonSlide, _imageCache: Map<string, Buffer | null>): void {
  const s = pptx.addSlide();
  s.background = { color: COLORS.textLight };
  s.addText(slide.title, {
    x: 0.8, y: 0.3, w: 8.4, h: 0.8,
    fontSize: 28, fontFace: FONTS.heading, color: COLORS.textDark, bold: true,
  });
  s.addText(slide.leftHeader, {
    x: 0.8, y: 1.2, w: 4.0, h: 0.5,
    fontSize: 18, fontFace: FONTS.heading, color: COLORS.accent, bold: true,
  });
  const leftBullets = slide.leftContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14, fontFace: FONTS.body, color: COLORS.textDark, paraSpaceAfter: 6,
    },
  }));
  s.addText(leftBullets as any, { x: 0.8, y: 1.8, w: 4.0, h: 4.6, valign: "top" });
  s.addShape("rect" as any, {
    x: 4.95, y: 1.2, w: 0.02, h: 5.2, fill: { color: COLORS.divider },
  });
  s.addText(slide.rightHeader, {
    x: 5.2, y: 1.2, w: 4.0, h: 0.5,
    fontSize: 18, fontFace: FONTS.heading, color: COLORS.accent, bold: true,
  });
  const rightBullets = slide.rightContent.bullets.map((text) => ({
    text,
    options: {
      bullet: { code: "2022" } as any,
      fontSize: 14, fontFace: FONTS.body, color: COLORS.textDark, paraSpaceAfter: 6,
    },
  }));
  s.addText(rightBullets as any, { x: 5.2, y: 1.8, w: 4.0, h: 4.6, valign: "top" });
}

// ── Main Builder ─────────────────────────────────────────────────────

const SLIDE_RENDERERS: Record<
  SlideInput["layout"],
  (pptx: PptxGenJS, slide: any, imageCache: Map<string, Buffer | null>) => void
> = {
  title: renderTitleSlide,
  content: renderContentSlide,
  image: renderImageSlide,
  "two-column": renderTwoColumnSlide,
  comparison: renderComparisonSlide,
};

export async function buildPresentation(input: PresentationInput): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.title = input.title;
  if (input.author) pptx.author = input.author;

  // Prefetch all images in parallel before building slides (avoids sequential HTTP round-trips)
  const imageUrls = collectImageUrls(input.slides);
  const imageEntries = await Promise.all(
    imageUrls.map(async (url) => [url, await safeFetchImage(url)] as const),
  );
  const imageCache = new Map<string, Buffer | null>(imageEntries);

  for (const slide of input.slides) {
    const renderer = SLIDE_RENDERERS[slide.layout];
    renderer(pptx, slide, imageCache);
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
