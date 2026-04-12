import { CORE } from "./core";
import { CHART } from "./chart";
import { MOCKUP } from "./mockup";
import { INTERACTIVE } from "./interactive";
import { DIAGRAM } from "./diagram";
import { ART } from "./art";

export const AVAILABLE_MODULES = [
  "chart",
  "mockup",
  "interactive",
  "diagram",
  "art",
] as const;

export type GuidelineModule = (typeof AVAILABLE_MODULES)[number];

const MODULE_MAP: Record<GuidelineModule, string> = {
  chart: CHART,
  mockup: MOCKUP,
  interactive: INTERACTIVE,
  diagram: DIAGRAM,
  art: ART,
};

export function getGuidelines(modules: GuidelineModule[]): string {
  let content = CORE;
  const seen = new Set<string>();
  for (const mod of modules) {
    const section = MODULE_MAP[mod];
    if (section && !seen.has(mod)) {
      seen.add(mod);
      content += "\n\n" + section;
    }
  }
  return content;
}
