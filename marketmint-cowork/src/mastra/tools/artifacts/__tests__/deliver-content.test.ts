import { describe, it, expect, vi } from "vitest";
import { deliverContent } from "../deliver-content";

vi.mock("@/lib/artifact-upload", () => ({
  uploadArtifact: vi.fn().mockResolvedValue({
    url: "https://cdn.marketmint.ai/artifacts/test-file.py",
    filename: "test-file.py",
    s3Key: "artifacts/test-file.py",
    fallbackContent: 'print("hello")',
  }),
  buildArtifactEventData: vi.fn().mockImplementation(
    (id, kind, status, title, opts) => ({
      id,
      kind,
      status,
      title,
      ...opts,
    }),
  ),
  canUseFallbackContent: vi.fn().mockReturnValue(true),
  resolveArtifactMimeType: vi.fn().mockReturnValue("text/plain"),
}));

describe("deliverContent", () => {
  it("has correct input schema with kind field", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "My Script",
      content: 'print("hello")',
      kind: "code",
      language: "python",
    });
    expect(parsed.kind).toBe("code");
    expect(parsed.language).toBe("python");
  });

  it("accepts csv kind", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "Data Export",
      content: "name,age\nAlice,30",
      kind: "csv",
    });
    expect(parsed.kind).toBe("csv");
  });

  it("defaults kind to markdown", () => {
    const schema = deliverContent.inputSchema;
    const parsed = schema.parse({
      title: "Blog Post",
      content: "# Hello\n\nWorld",
    });
    expect(parsed.kind).toBeUndefined(); // default applied in execute
  });
});
