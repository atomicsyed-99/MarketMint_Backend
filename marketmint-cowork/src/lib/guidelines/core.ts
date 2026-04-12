export const CORE = `
# Generative UI Design System — Marketmint

## Available Modules
- **chart** — Chart.js data visualizations (line, bar, doughnut, stacked)
- **mockup** — Dashboards, KPI cards, data tables, badges, progress bars
- **interactive** — Sliders, toggles, calculators, tabs
- **diagram** — SVG flowcharts, process diagrams, trees
- **art** — Canvas animations, SVG illustrations

## Philosophy
- **Monochrome**: UI uses only black, white, and grays. Color is reserved for status indicators and data visualization only.
- **Minimal**: no shadows, no gradients, no blur. Depth comes from borders and spacing.
- **Professional**: clean enterprise aesthetic — form follows function.
- **Compact**: every pixel earns its place; whitespace is deliberate, not filler.

## HTML Structure Rules
- Output **HTML fragments only** — never use DOCTYPE, <html>, <head>, or <body> tags
- Follow this strict order: **<style> → HTML content → <script>**
- This order is critical for streaming: styles load first, then markup renders, then scripts hydrate
- Use semantic HTML where appropriate (section, article, figure, table)

## Color Palette (CSS Custom Properties)

\`\`\`css
:root {
  /* Backgrounds */
  --bg: #FFFFFF;
  --bg-secondary: #FAFAFA;
  --bg-tertiary: #F5F5F5;
  --surface: #FFFFFF;
  --surface-hover: #FAFAFA;

  /* Text */
  --text: #000000;
  --text-secondary: #525252;
  --text-tertiary: #737373;
  --text-muted: #A3A3A3;
  --text-inverse: #FFFFFF;

  /* Borders */
  --border: #E5E5E5;
  --border-input: #D4D4D4;
  --border-focus: #000000;
  --border-hover: #A3A3A3;

  /* Primary (monochrome) */
  --primary: #000000;
  --primary-hover: #1A1A1A;
  --primary-text: #FFFFFF;

  /* Status colors (use sparingly, text only — no background fills) */
  --status-complete: #16A34A;
  --status-progress: #EA580C;
  --status-review: #2563EB;
  --status-error: #DC2626;
  --status-draft: #737373;

  /* Chart accent palette (for data visualization only) */
  --chart-1: #000000;
  --chart-2: #525252;
  --chart-3: #737373;
  --chart-4: #A3A3A3;
  --chart-5: #D4D4D4;
}
\`\`\`

**IMPORTANT:** You MUST include the full \`:root { ... }\` CSS custom property block in your \`<style>\` section. The widget renders in an isolated iframe with no parent styles — variables will be undefined without it.

## Typography
- **Font family**: Inter, system-ui, -apple-system, sans-serif
- **Weights**: 300 (light), 400 (normal), 500 (medium), 600 (semibold), 700 (bold)
- **Scale**:
  - 48px / weight 300 / tracking -0.02em / line-height 1.1 — hero greeting
  - 24-30px / weight 700 / tracking -0.025em / line-height 1.2 — page title
  - 18-20px / weight 600 / tracking -0.01em / line-height 1.3 — section title
  - 16px / weight 600 / line-height 1.4 — card title
  - 14px / weight 400 / line-height 1.625 — body text (color: var(--text-secondary))
  - 12px / weight 500 / tracking 0.05em / line-height 1.4 — label (color: var(--text-tertiary))
  - 11px / weight 400 / line-height 1.4 — caption (color: var(--text-muted))
- **Case**: sentence case always — never uppercase except table headers

## Layout
- Use **CSS Grid** for dashboard layouts and **Flexbox** for component internals
- **Padding**: 20px for cards, 16px for compact elements, 24-40px for page-level
- **Border-radius**: 12px for cards/modals, 8px for inputs/images, 9999px for buttons/badges
- **Gaps**: 24px between grid items, 16px between card items, 8px between inline elements
- **Borders**: 1px solid var(--border) — this is the primary depth mechanism (not shadow)

## Complexity Budget
- Subtitles: **5 words max**
- Color in UI chrome: **none** — only black, white, and grays
- Status text: use --status-* variables, no background fills on status badges
- KPI cards: **4 per row max**
- Keep widgets focused — if data needs more than one screen, split into multiple widgets

## Component Quick Reference

### Buttons
- Primary: bg var(--primary), color var(--primary-text), border-radius 9999px, height 40px, padding 0 20px
- Secondary: bg transparent, border 1px var(--primary), color var(--text), same shape
- Ghost: bg transparent, no border, color var(--text-secondary)
- All buttons use font-weight 500, font-size 14px

### Cards
- Background: var(--surface), border 1px solid var(--border), border-radius 12px, padding 20px
- No box-shadow — use borders for visual separation

### Stats / Metric Display
- Value: 24px, font-weight 700, color var(--text)
- Label: 12px, font-weight 500, color var(--text-tertiary)
- Separated by 1px vertical divider var(--border) when inline

## Forbidden
- No gradients in UI chrome (linear-gradient, radial-gradient) — only allowed in image placeholders
- No box-shadow or text-shadow — use borders instead
- No backdrop-filter or blur effects
- No colored backgrounds for status badges — use colored text only
- No inline event handlers (onclick, onchange) — use addEventListener in <script> blocks
- No external images unless from user data — use CSS gradients for placeholders
- No accent colors in UI chrome — only monochrome (black/white/gray)
`;
