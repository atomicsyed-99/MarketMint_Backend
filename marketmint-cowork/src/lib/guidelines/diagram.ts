export const DIAGRAM = `
# Module: Diagram

## SVG Setup
Always use viewBox for responsive scaling:
\`\`\`html
<svg viewBox="0 0 800 400" xmlns="http://www.w3.org/2000/svg"
     style="width: 100%; height: auto; font-family: Inter, system-ui, -apple-system, sans-serif;">
  <defs>
    <!-- Arrow marker -->
    <marker id="arrow" viewBox="0 0 10 6" refX="10" refY="3"
            markerWidth="10" markerHeight="6" orient="auto-start-reverse">
      <path d="M 0 0 L 10 3 L 0 6 z" fill="#A3A3A3" />
    </marker>
  </defs>
  <!-- Diagram content here -->
</svg>
\`\`\`

## Box / Node Styling
\`\`\`html
<!-- Standard node -->
<rect x="50" y="50" width="140" height="48" rx="12"
      fill="#FFFFFF" stroke="#E5E5E5" stroke-width="1" />
<text x="120" y="78" text-anchor="middle"
      font-size="14" fill="#000000">Node Label</text>

<!-- Highlighted / active node -->
<rect x="50" y="50" width="140" height="48" rx="12"
      fill="#000000" stroke="#000000" stroke-width="1" />
<text x="120" y="78" text-anchor="middle"
      font-size="14" fill="#FFFFFF" font-weight="500">Active Node</text>
\`\`\`

Node sizing:
- Standard: 140 x 48px, rx=12
- Large (with subtitle): 160 x 64px, rx=12
- Small (compact): 100 x 36px, rx=8

## Arrow / Connector Styling
\`\`\`html
<!-- Straight connector with arrow -->
<line x1="190" y1="74" x2="250" y2="74"
      stroke="#D4D4D4" stroke-width="1.5"
      marker-end="url(#arrow)" />

<!-- Curved connector -->
<path d="M 190 74 C 220 74, 220 150, 250 150"
      fill="none" stroke="#D4D4D4" stroke-width="1.5"
      marker-end="url(#arrow)" />

<!-- Dashed connector (optional flow) -->
<line x1="190" y1="74" x2="250" y2="74"
      stroke="#D4D4D4" stroke-width="1.5"
      stroke-dasharray="4 3"
      marker-end="url(#arrow)" />
\`\`\`

## Arrow Markers with Defs
Define multiple marker colors for different states:
\`\`\`html
<defs>
  <marker id="arrow-default" viewBox="0 0 10 6" refX="10" refY="3"
          markerWidth="10" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 3 L 0 6 z" fill="#A3A3A3" />
  </marker>
  <marker id="arrow-active" viewBox="0 0 10 6" refX="10" refY="3"
          markerWidth="10" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 3 L 0 6 z" fill="#000000" />
  </marker>
  <marker id="arrow-success" viewBox="0 0 10 6" refX="10" refY="3"
          markerWidth="10" markerHeight="6" orient="auto-start-reverse">
    <path d="M 0 0 L 10 3 L 0 6 z" fill="#16A34A" />
  </marker>
</defs>
\`\`\`

## Layout Patterns

### Horizontal Flow (left to right)
Space nodes evenly along x-axis with consistent y:
\`\`\`
x: 50, 240, 430, 620  (gap of 190 = node width 140 + spacing 50)
y: 50 (constant)
\`\`\`

### Vertical Flow (top to bottom)
Space nodes evenly along y-axis with consistent x:
\`\`\`
x: 330 (centered in 800-wide viewBox)
y: 30, 110, 190, 270  (gap of 80 = node height 48 + spacing 32)
\`\`\`

### Tree Layout
Center parent, space children evenly below:
\`\`\`
Parent: x=330, y=30
Children: x=130, x=330, x=530, y=130
\`\`\`

## State Colors
Use these fills and strokes for stateful nodes:
- **Active** (current step): fill=#000000, stroke=#000000, text=#FFFFFF
- **Success** (completed): fill=#FFFFFF, stroke=#16A34A, text=#16A34A
- **Warning** (attention): fill=#FFFFFF, stroke=#EA580C, text=#EA580C
- **Error** (failed): fill=#FFFFFF, stroke=#DC2626, text=#DC2626
- **Default** (inactive): fill=#FFFFFF, stroke=#E5E5E5, text=#000000
- **Disabled** (unavailable): fill=#FAFAFA, stroke=#E5E5E5, text=#A3A3A3

## Labels on Connectors
\`\`\`html
<text x="220" y="68" text-anchor="middle"
      font-size="11" fill="#737373">label text</text>
\`\`\`
`;
