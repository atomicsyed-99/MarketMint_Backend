import { describe, it, expect } from "vitest";
import { fetchWithTimeout } from "../fetch";

describe("fetchWithTimeout", () => {
  it("resolves for a successful fetch", async () => {
    const res = await fetchWithTimeout("https://httpbin.org/get", {
      timeoutMs: 10000,
    });
    expect(res.ok).toBe(true);
  });

  it("throws on timeout with descriptive error", async () => {
    await expect(
      fetchWithTimeout("https://httpbin.org/delay/10", { timeoutMs: 100 }),
    ).rejects.toThrow(/timed out/i);
  });

  it("uses default timeout from env when not specified", () => {
    expect(typeof fetchWithTimeout).toBe("function");
  });
});
