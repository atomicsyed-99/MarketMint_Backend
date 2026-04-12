import { describe, it, expect } from "vitest";
import { normalizeAgentId } from "../normalize-agent-id";

describe("normalizeAgentId", () => {
  it("maps legacy creative-director wire forms to orchestrator", () => {
    expect(normalizeAgentId("creative-director")).toBe("orchestrator");
    expect(normalizeAgentId("creativeDirectorAgent")).toBe("orchestrator");
    expect(normalizeAgentId("creative-director-agent")).toBe("orchestrator");
    expect(normalizeAgentId("agent-creativeDirectorAgent")).toBe("orchestrator");
  });

  it("maps performance-marketing alias to manager key via AGENT_ID_ALIASES", () => {
    expect(normalizeAgentId("performanceMarketingAgent")).toBe(
      "performance-marketing-manager",
    );
    expect(normalizeAgentId("performance-marketing-agent")).toBe(
      "performance-marketing-manager",
    );
  });

  it("maps marketmint-agent and marketmint-agent aliases to orchestrator", () => {
    expect(normalizeAgentId("marketmint-agent")).toBe("orchestrator");
    expect(normalizeAgentId("marketmint-agent")).toBe("orchestrator");
  });

  it("preserves orchestrator id (no suffix, no camelCase)", () => {
    expect(normalizeAgentId("orchestrator")).toBe("orchestrator");
  });

  it("handles shopifyStoreManagerAgent registry key", () => {
    expect(normalizeAgentId("shopifyStoreManagerAgent")).toBe(
      "shopify-store-manager",
    );
  });

  it("returns empty string for empty/whitespace input", () => {
    expect(normalizeAgentId("")).toBe("");
    expect(normalizeAgentId("   ")).toBe("");
  });
});
