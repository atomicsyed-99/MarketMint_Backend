import { describe, it, expect } from "vitest";
import { buildPresentation, type SlideInput } from "../pptx-builder";

describe("buildPresentation", () => {
  it("generates a Buffer from title slide", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "Q4 Review", subtitle: "Sales Department" },
    ];
    const buffer = await buildPresentation({ title: "Q4 Review", slides });
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.byteLength).toBeGreaterThan(0);
  });

  it("generates slides with content layout", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "Deck Title" },
      {
        layout: "content",
        title: "Key Findings",
        bullets: ["Revenue up 23%", "Costs down 15%", "NPS improved to 72"],
      },
    ];
    const buffer = await buildPresentation({ title: "Deck", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("generates slides with image layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "image",
        title: "Hero Shot",
        imageUrl: "https://via.placeholder.com/1920x1080",
        caption: "Product lifestyle image",
      },
    ];
    const buffer = await buildPresentation({ title: "Visual", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("handles two-column layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "two-column",
        title: "Before & After",
        leftContent: { bullets: ["Old design", "Low conversion"] },
        rightContent: { bullets: ["New design", "High conversion"] },
      },
    ];
    const buffer = await buildPresentation({ title: "Compare", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("handles comparison layout", async () => {
    const slides: SlideInput[] = [
      {
        layout: "comparison",
        title: "Plan Options",
        leftHeader: "Basic",
        leftContent: { bullets: ["5 users", "$10/mo"] },
        rightHeader: "Pro",
        rightContent: { bullets: ["50 users", "$50/mo"] },
      },
    ];
    const buffer = await buildPresentation({ title: "Plans", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });

  it("handles multi-slide deck", async () => {
    const slides: SlideInput[] = [
      { layout: "title", title: "One" },
      { layout: "content", title: "Two", bullets: ["A"] },
      { layout: "content", title: "Three", bullets: ["B"] },
    ];
    const buffer = await buildPresentation({ title: "Multi", slides });
    expect(buffer).toBeInstanceOf(Buffer);
  });
});
