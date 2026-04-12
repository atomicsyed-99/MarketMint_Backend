/**
 * Shared helper for emitting data-agent-utility events from core tools.
 * Provides typed categories and consistent event structure.
 */

export type UtilityStatus = "loaded" | "running" | "completed" | "failed";
export type UtilityCategory =
  | "connector"
  | "search"
  | "generation"
  | "workflow"
  | "brand"
  | "planning";

export interface EmitUtilityOptions {
  id: string;
  name: string;
  title: string;
  category: UtilityCategory;
  status: UtilityStatus;
  description: string;
  steps?: Array<Record<string, unknown>>;
  duration_ms?: number;
  output?: Record<string, unknown>;
  error?: string;
  web_urls?: Array<{ url: string; title?: string; description?: string }>;
  /** When true, stream processor skips persisting/forwards minimally (background ops). */
  internal?: boolean;
}

export function emitUtility(context: any, opts: EmitUtilityOptions) {
  const { id, ...rest } = opts;
  context?.writer?.custom({
    type: "data-agent-utility",
    id,
    data: { id, ...rest },
  });
}
