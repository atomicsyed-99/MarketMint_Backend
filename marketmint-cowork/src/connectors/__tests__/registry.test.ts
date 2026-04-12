import { describe, it, expect } from "vitest";
import {
  getConnectorByProviderKey,
  SHOPIFY_PER_CLIENT_KEY_PATTERN,
} from "@/connectors/registry";

describe("SHOPIFY_PER_CLIENT_KEY_PATTERN", () => {
  it("matches canonical slug shapes", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme-7f3a2b")).toBe(true);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-a-000000")).toBe(true);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-longer-slug-name-abcdef")).toBe(false);
  });

  it("rejects short random suffix", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme-7f3a2")).toBe(false);
  });

  it("rejects uppercase", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-ACME-7f3a2b")).toBe(false);
  });

  it("rejects missing random suffix", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-acme")).toBe(false);
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify-")).toBe(false);
  });

  it("rejects the canonical key itself", () => {
    expect(SHOPIFY_PER_CLIENT_KEY_PATTERN.test("shopify")).toBe(false);
  });
});

describe("getConnectorByProviderKey", () => {
  it("direct-matches the canonical shopify key", () => {
    const c = getConnectorByProviderKey("shopify");
    expect(c?.id).toBe("shopify");
  });

  it("direct-matches non-shopify keys", () => {
    expect(getConnectorByProviderKey("meta-marketing-api")?.id).toBe("meta-marketing-api");
    expect(getConnectorByProviderKey("google-sheet")?.id).toBe("google-sheets");
  });

  it("resolves slug-shaped shopify keys to the canonical shopify connector", () => {
    const c = getConnectorByProviderKey("shopify-acme-7f3a2b");
    expect(c?.id).toBe("shopify");
  });

  it("does not resolve loose shopify-* keys", () => {
    expect(getConnectorByProviderKey("shopify-partner")).toBeUndefined();
    expect(getConnectorByProviderKey("shopify-legacy")).toBeUndefined();
  });

  it("returns undefined for unknown keys", () => {
    expect(getConnectorByProviderKey("nonsense")).toBeUndefined();
  });
});
