import PDFDocument from "pdfkit";
import { createLogger } from "@/lib/logger";
import { safeFetchImage } from "@/lib/url-safety";

const log = createLogger("pdf-builder");

// ── Section Types ────────────────────────────────────────────────────

interface TextSection {
  type: "text";
  content: string;
}

interface HeadingSection {
  type: "heading";
  content: string;
  level?: 1 | 2 | 3;
}

interface BulletSection {
  type: "bullets";
  items: string[];
}

interface ImageSection {
  type: "image";
  url: string;
  caption?: string;
  width?: number;
}

interface TableSection {
  type: "table";
  headers: string[];
  rows: string[][];
}

interface DividerSection {
  type: "divider";
}

export type PdfSection =
  | TextSection
  | HeadingSection
  | BulletSection
  | ImageSection
  | TableSection
  | DividerSection;

export interface PdfInput {
  title: string;
  subtitle?: string;
  author?: string;
  sections: PdfSection[];
}

// ── Theme Constants ──────────────────────────────────────────────────

const COLORS = {
  primary: "#1A1A2E",
  accent: "#E94560",
  text: "#1A1A2E",
  subtle: "#6B7280",
  divider: "#E5E7EB",
  tableBorder: "#D1D5DB",
  tableHeader: "#F3F4F6",
} as const;

const FONTS = {
  heading: "Helvetica-Bold",
  body: "Helvetica",
  italic: "Helvetica-Oblique",
} as const;

const MARGIN = { top: 72, bottom: 72, left: 72, right: 72 };
const PAGE_WIDTH = 595.28; // A4
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN.left - MARGIN.right;

// Image fetching uses shared safeFetchImage from @/lib/url-safety
// (SSRF protection, HTTPS-only, 10MB size limit, redirect rejection)

// ── Section Renderers ────────────────────────────────────────────────

function renderHeading(doc: PDFKit.PDFDocument, section: HeadingSection): void {
  const level = section.level ?? 1;
  const fontSize = level === 1 ? 24 : level === 2 ? 18 : 14;
  const spacing = level === 1 ? 16 : 12;

  doc
    .font(FONTS.heading)
    .fontSize(fontSize)
    .fillColor(COLORS.primary)
    .text(section.content, { lineGap: 4 })
    .moveDown(spacing / fontSize);
}

function renderText(doc: PDFKit.PDFDocument, section: TextSection): void {
  doc
    .font(FONTS.body)
    .fontSize(11)
    .fillColor(COLORS.text)
    .text(section.content, { lineGap: 3, align: "left" })
    .moveDown(0.5);
}

function renderBullets(doc: PDFKit.PDFDocument, section: BulletSection): void {
  doc.font(FONTS.body).fontSize(11).fillColor(COLORS.text);

  for (const item of section.items) {
    doc.text(`\u2022  ${item}`, {
      indent: 16,
      lineGap: 3,
    });
  }
  doc.moveDown(0.5);
}

function renderImage(
  doc: PDFKit.PDFDocument,
  section: ImageSection,
  imageCache: Map<string, Buffer | null>,
): void {
  const imageBuffer = imageCache.get(section.url) ?? null;
  if (!imageBuffer) {
    doc
      .font(FONTS.italic)
      .fontSize(10)
      .fillColor(COLORS.subtle)
      .text("[Image unavailable]", { align: "center" })
      .moveDown(0.5);
    return;
  }

  const maxWidth = section.width ?? CONTENT_WIDTH;
  doc.image(imageBuffer, {
    fit: [maxWidth, 300],
    align: "center",
  });

  if (section.caption) {
    doc.moveDown(0.3);
    doc
      .font(FONTS.italic)
      .fontSize(9)
      .fillColor(COLORS.subtle)
      .text(section.caption, { align: "center" });
  }
  doc.moveDown(0.5);
}

function renderTable(doc: PDFKit.PDFDocument, section: TableSection): void {
  const colCount = section.headers.length;
  const colWidth = CONTENT_WIDTH / colCount;
  const rowHeight = 22;
  const startX = MARGIN.left;
  let y = doc.y;

  // Ensure at least the header + 1 data row fit on the current page
  const minTableHeight = rowHeight * 2;
  if (y + minTableHeight > doc.page.height - MARGIN.bottom) {
    doc.addPage();
    y = MARGIN.top;
  }

  // Header row
  doc
    .rect(startX, y, CONTENT_WIDTH, rowHeight)
    .fill(COLORS.tableHeader);

  doc.font(FONTS.heading).fontSize(9).fillColor(COLORS.text);
  for (let i = 0; i < colCount; i++) {
    doc.text(section.headers[i], startX + i * colWidth + 6, y + 6, {
      width: colWidth - 12,
      height: rowHeight,
      lineBreak: false,
    });
  }
  y += rowHeight;

  // Data rows
  doc.font(FONTS.body).fontSize(9).fillColor(COLORS.text);
  for (const row of section.rows) {
    // Row border
    doc
      .moveTo(startX, y)
      .lineTo(startX + CONTENT_WIDTH, y)
      .strokeColor(COLORS.tableBorder)
      .lineWidth(0.5)
      .stroke();

    for (let i = 0; i < colCount; i++) {
      const cellText = row[i] ?? "";
      doc.text(cellText, startX + i * colWidth + 6, y + 6, {
        width: colWidth - 12,
        height: rowHeight,
        lineBreak: false,
      });
    }
    y += rowHeight;

    // New page if needed
    if (y > doc.page.height - MARGIN.bottom) {
      doc.addPage();
      y = MARGIN.top;
    }
  }

  // Bottom border
  doc
    .moveTo(startX, y)
    .lineTo(startX + CONTENT_WIDTH, y)
    .strokeColor(COLORS.tableBorder)
    .lineWidth(0.5)
    .stroke();

  doc.y = y + 12;
  doc.moveDown(0.5);
}

function renderDivider(doc: PDFKit.PDFDocument): void {
  const y = doc.y + 6;
  doc
    .moveTo(MARGIN.left, y)
    .lineTo(PAGE_WIDTH - MARGIN.right, y)
    .strokeColor(COLORS.divider)
    .lineWidth(1)
    .stroke();
  doc.y = y + 12;
}

// ── Title Page ───────────────────────────────────────────────────────

function renderTitlePage(doc: PDFKit.PDFDocument, input: PdfInput): void {
  doc.moveDown(6);

  // Accent bar
  doc
    .rect(MARGIN.left, doc.y, 60, 4)
    .fill(COLORS.accent);
  doc.moveDown(1);

  // Title
  doc
    .font(FONTS.heading)
    .fontSize(32)
    .fillColor(COLORS.primary)
    .text(input.title, { lineGap: 6 });

  // Subtitle
  if (input.subtitle) {
    doc.moveDown(0.5);
    doc
      .font(FONTS.body)
      .fontSize(16)
      .fillColor(COLORS.subtle)
      .text(input.subtitle);
  }

  // Author
  if (input.author) {
    doc.moveDown(1);
    doc
      .font(FONTS.italic)
      .fontSize(12)
      .fillColor(COLORS.subtle)
      .text(`By ${input.author}`);
  }

  doc.addPage();
}

// ── Main Builder ─────────────────────────────────────────────────────

/**
 * Build a PDF document from structured section inputs.
 * Returns a Node.js Buffer ready for S3 upload.
 */
export async function buildPdf(input: PdfInput): Promise<{ buffer: Buffer; pageCount: number }> {
  const doc = new PDFDocument({
    size: "A4",
    margins: MARGIN,
    info: {
      Title: input.title,
      Author: input.author ?? "Marketmint",
    },
  });

  // Collect output chunks into a buffer (resolved when doc.end() is called)
  const bufferPromise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // Prefetch all images in parallel before rendering (avoids sequential HTTP round-trips)
  const imageUrls = input.sections
    .filter((s): s is ImageSection => s.type === "image")
    .map((s) => s.url);
  const imageEntries = await Promise.all(
    imageUrls.map(async (url) => [url, await safeFetchImage(url)] as const),
  );
  const imageCache = new Map<string, Buffer | null>(imageEntries);

  // Title page
  renderTitlePage(doc, input);

  // Content sections
  for (const section of input.sections) {
    switch (section.type) {
      case "heading":
        renderHeading(doc, section);
        break;
      case "text":
        renderText(doc, section);
        break;
      case "bullets":
        renderBullets(doc, section);
        break;
      case "image":
        renderImage(doc, section, imageCache);
        break;
      case "table":
        renderTable(doc, section);
        break;
      case "divider":
        renderDivider(doc);
        break;
    }
  }

  // Get page count before finalizing
  const pageRange = doc.bufferedPageRange();
  const pageCount = pageRange.start + pageRange.count;

  doc.end();

  const buffer = await bufferPromise;
  return { buffer, pageCount };
}
