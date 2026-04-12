import { stringFromRequestContext, workspaceIdFromRequestContext } from "@/lib/request-context-workspace";

type GeoRequestContext = {
  userId?: string;
  email?: string;
  directGenBm?: boolean;
  direct_gen_bm?: boolean;
  get?: (k: string) => unknown;
} | undefined;

export function getGeoRequestContext(context: unknown): GeoRequestContext {
  if (!context || typeof context !== "object") return undefined;
  return context as GeoRequestContext;
}

export function getWorkspaceId(context: unknown): string {
  return workspaceIdFromRequestContext(context);
}

export function getUserId(context: unknown): string | undefined {
  return stringFromRequestContext(context, "userId");
}

export function getUserEmail(context: unknown): string | undefined {
  return stringFromRequestContext(context, "email");
}

export function isBrandMemoryEnabled(context: unknown): boolean {
  const rc = getGeoRequestContext(context);
  if (!rc) return false;
  const byGet = typeof rc.get === "function" ? rc.get("directGenBm") : undefined;
  if (typeof byGet === "boolean") return byGet;
  if (typeof rc.directGenBm === "boolean") return rc.directGenBm;
  if (typeof rc.direct_gen_bm === "boolean") return rc.direct_gen_bm;
  return false;
}

export function normalizePromptCategory(category: string | undefined): string | null {
  if (!category) return null;
  const normalized = category.trim().toLowerCase().replace(/\s+/g, "_");
  return normalized || null;
}
