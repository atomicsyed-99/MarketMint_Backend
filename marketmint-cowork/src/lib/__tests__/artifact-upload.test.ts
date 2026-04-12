import { describe, it, expect, vi } from "vitest";
import {
  titleToSlug,
  buildArtifactFilename,
  validateArtifactContent,
  canUseFallbackContent,
  uploadArtifact,
} from "../artifact-upload";

vi.mock("@/lib/s3", () => ({
  uploadToS3: vi.fn().mockResolvedValue("artifacts/123-abc/test-report.csv"),
  refreshSignedUrl: vi.fn().mockResolvedValue("https://cdn.marketmint.ai/artifacts/123-abc/test-report.csv"),
}));

vi.mock("@/lib/call-python-assets-credits", () => ({
  notifyPythonStoreGeneratedAssets: vi.fn().mockResolvedValue(undefined),
}));

describe("titleToSlug", () => {
  it("converts title to url-safe slug", () => {
    expect(titleToSlug("Sales Report Q4 2026")).toBe("sales-report-q4-2026");
  });

  it("strips special characters", () => {
    expect(titleToSlug("Hello, World! (v2)")).toBe("hello-world-v2");
  });

  it("collapses multiple dashes", () => {
    expect(titleToSlug("foo---bar")).toBe("foo-bar");
  });

  it("truncates to 60 chars", () => {
    const long = "a".repeat(100);
    expect(titleToSlug(long).length).toBeLessThanOrEqual(60);
  });
});

describe("buildArtifactFilename", () => {
  it("uses language extension for code artifacts", () => {
    const name = buildArtifactFilename("My Script", "code", { language: "python" });
    expect(name).toBe("my-script.py");
  });

  it("uses default extension from config", () => {
    const name = buildArtifactFilename("Data Export", "csv");
    expect(name).toBe("data-export.csv");
  });

  it("uses custom filename if provided in metadata", () => {
    const name = buildArtifactFilename("Ignored Title", "json", { filename: "config.json" });
    expect(name).toBe("config.json");
  });
});

describe("validateArtifactContent", () => {
  it("accepts valid JSON", () => {
    expect(() => validateArtifactContent("json", '{"key": "value"}')).not.toThrow();
  });

  it("rejects invalid JSON", () => {
    expect(() => validateArtifactContent("json", "{bad json")).toThrow("Invalid JSON");
  });

  it("accepts valid CSV with header", () => {
    expect(() => validateArtifactContent("csv", "name,age\nAlice,30")).not.toThrow();
  });

  it("rejects empty CSV", () => {
    expect(() => validateArtifactContent("csv", "")).toThrow("CSV content is empty");
  });

  it("rejects CSV without comma in header", () => {
    expect(() => validateArtifactContent("csv", "just a line\nno commas")).toThrow("comma-separated header");
  });

  it("does not validate markdown content", () => {
    expect(() => validateArtifactContent("markdown", "anything")).not.toThrow();
  });

  it("does not validate code content", () => {
    expect(() => validateArtifactContent("code", "def foo(): pass")).not.toThrow();
  });
});

describe("canUseFallbackContent", () => {
  it("returns true for small content", () => {
    expect(canUseFallbackContent("hello")).toBe(true);
  });

  it("returns false for content over 100KB", () => {
    const large = "x".repeat(101 * 1024);
    expect(canUseFallbackContent(large)).toBe(false);
  });

  it("returns true for content exactly at 100KB", () => {
    const exact = "x".repeat(100 * 1024);
    expect(canUseFallbackContent(exact)).toBe(true);
  });
});

describe("uploadArtifact (integration with mocks)", () => {
  it("uploads to S3 with UUID-prefixed path and returns CDN URL", async () => {
    const result = await uploadArtifact({
      title: "Test Report",
      kind: "csv",
      content: "name,age\nAlice,30",
      toolName: "deliverContent",
    });
    expect(result.url).toContain("cdn");
    expect(result.filename).toBe("test-report.csv");
    expect(result.s3Key).toContain("artifacts/");
    expect(result.s3Key).toContain("/test-report.csv");
    expect(result.fallbackContent).toBe("name,age\nAlice,30");
  });

  it("returns undefined fallbackContent for large files", async () => {
    const largeContent = "x".repeat(101 * 1024);
    const result = await uploadArtifact({
      title: "Big File",
      kind: "code",
      content: largeContent,
      toolName: "deliverContent",
    });
    expect(result.fallbackContent).toBeUndefined();
  });

  it("throws on invalid JSON content", async () => {
    await expect(
      uploadArtifact({
        title: "Bad JSON",
        kind: "json",
        content: "{not valid",
        toolName: "deliverContent",
      }),
    ).rejects.toThrow("Invalid JSON");
  });
});
