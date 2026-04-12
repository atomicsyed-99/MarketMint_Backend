import { describe, it, expect } from "vitest";
import { RequestContext } from "@mastra/core/request-context";
import {
  stringFromRequestContext,
  workspaceIdFromRequestContext,
} from "@/lib/request-context-workspace";

describe("workspaceIdFromRequestContext", () => {
  it("reads Mastra RequestContext via .get", () => {
    const rc = new RequestContext();
    rc.set("workspaceId", "org_abc");
    expect(workspaceIdFromRequestContext(rc)).toBe("org_abc");
  });

  it("reads chat-style plain object", () => {
    expect(workspaceIdFromRequestContext({ workspaceId: "user_xyz" })).toBe("user_xyz");
  });

  it("returns empty when missing", () => {
    expect(workspaceIdFromRequestContext(new RequestContext())).toBe("");
  });

  it("stringFromRequestContext reads chatId from RequestContext", () => {
    const rc = new RequestContext();
    rc.set("chatId", "c1");
    expect(stringFromRequestContext(rc, "chatId")).toBe("c1");
  });
});
