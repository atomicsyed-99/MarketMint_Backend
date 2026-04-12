import path from "node:path";
import { fileURLToPath } from "node:url";
import { Workspace, LocalFilesystem } from "@mastra/core/workspace";

/**
 * Per-agent scoped workspaces.
 *
 * Each agent gets its own Workspace instance with only the skills it needs.
 * The main orchestrator includes strategy skills plus creative/generation skills
 * so image, video, and template workflows run without a separate creative sub-agent.
 *
 * Skills live in src/mastra/skills/ — each subfolder contains a SKILL.md.
 */

// In bundled output (.mastra/output/index.mjs): __dirname = .mastra/output/, 2x.. = project root.
// Mastra always runs from the bundle (both `mastra dev` and `mastra build`),
// so import.meta.url resolves to the bundle location, not the source file.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..", "..");

const sharedFs = new LocalFilesystem({
  basePath: projectRoot,
  contained: true,
  readOnly: true,
});

const s = "src/mastra/skills";

// ---------------------------------------------------------------------------
// Orchestrator — strategy + routing + full creative/generation skill surface
// ---------------------------------------------------------------------------

export const orchestratorWorkspace = new Workspace({
  id: "orchestrator-workspace",
  name: "Orchestrator Skills",
  filesystem: sharedFs,
  bm25: true,
  skills: [
    `${s}/agent-orchestration`,
    `${s}/marketing-ideas`,
    `${s}/marketing-psychology`,
    `${s}/launch-strategy`,
    `${s}/pricing-strategy`,
    `${s}/competitor-alternatives`,
    `${s}/referral-program`,
    `${s}/free-tool-strategy`,
    `${s}/creative-generation`,
    `${s}/creative-director`,
    `${s}/templates`,
    `${s}/static-ad-creative`,
    `${s}/hero-campaign-banner`,
    `${s}/social-content`,
    `${s}/product-infographic`,
    `${s}/feature-highlight-graphic`,
    `${s}/image-editing`,
    `${s}/presentation-generator`,
    `${s}/multiple-try-on`,
    `${s}/garment-in-lifestyle-settings`,
    `${s}/garment-in-studio-settings`,
    `${s}/non-garment-in-lifestyle-settings`,
    `${s}/non-garment-in-studio-settings`,
    `${s}/product-swap-or-try-on`,
    `${s}/background-replacer`,
    `${s}/sketch-to-product`,
    `${s}/material-close-up`,
    `${s}/jewellery-photoshoot`,
    `${s}/video-generator`,
    `${s}/template-video`,
    `${s}/creative-video-generation`,
    `${s}/copywriting`,
    `${s}/copy-editing`,
    `${s}/paid-ads`,
  ],
});

// ---------------------------------------------------------------------------
// Performance Marketing — ad analysis, A/B testing, analytics
// ---------------------------------------------------------------------------

export const perfMarketingWorkspace = new Workspace({
  id: "perf-marketing-workspace",
  name: "Performance Marketing Skills",
  filesystem: sharedFs,
  bm25: true,
  skills: [
    `${s}/generative-ui`,
    `${s}/paid-ads`,
    `${s}/ab-test-setup`,
    `${s}/analytics-tracking`,
  ],
});

// ---------------------------------------------------------------------------
// Shopify Store Manager — store ops, CRO, SEO, storefront
// ---------------------------------------------------------------------------

export const storeManagerWorkspace = new Workspace({
  id: "store-manager-workspace",
  name: "Store Manager Skills",
  filesystem: sharedFs,
  bm25: true,
  skills: [
    `${s}/shopify`,
    `${s}/shopify-storefront`,
    `${s}/seo-audit`,
    `${s}/schema-markup`,
    `${s}/page-cro`,
    `${s}/programmatic-seo`,
    `${s}/form-cro`,
    `${s}/onboarding-cro`,
    `${s}/paywall-upgrade-cro`,
    `${s}/popup-cro`,
    `${s}/signup-flow-cro`,
  ],
});

// ---------------------------------------------------------------------------
// Email & CRM Manager — email sequences, copywriting, A/B testing
// ---------------------------------------------------------------------------

export const emailCrmWorkspace = new Workspace({
  id: "email-crm-workspace",
  name: "Email & CRM Skills",
  filesystem: sharedFs,
  bm25: true,
  skills: [
    `${s}/email-sequence`,
    `${s}/copywriting`,
    `${s}/ab-test-setup`,
  ],
});

// ---------------------------------------------------------------------------
// GEO Optimizer — LLM citation optimization, GEO audits, and schema strategy
// ---------------------------------------------------------------------------

export const geoOptimizerWorkspace = new Workspace({
  id: "geo-optimizer-workspace",
  name: "GEO Optimizer Skills",
  filesystem: sharedFs,
  bm25: true,
  skills: [
    `${s}/geo-optimization`,
    `${s}/seo-audit`,
    `${s}/schema-markup`,
  ],
});
