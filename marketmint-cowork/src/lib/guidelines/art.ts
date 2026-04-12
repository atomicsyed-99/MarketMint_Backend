export const ART = `
# Module: Art

## Canvas Setup
\`\`\`html
<canvas id="artCanvas" width="800" height="600" style="width: 100%; height: auto; display: block;"></canvas>
<script>
  const canvas = document.getElementById('artCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Your drawing code here
</script>
\`\`\`

Always set canvas width/height via attributes (not CSS) to avoid scaling artifacts.
Use CSS \`width: 100%; height: auto;\` for responsive display.

## Animation with requestAnimationFrame
\`\`\`js
let animationId;
let startTime;

function animate(timestamp) {
  if (!startTime) startTime = timestamp;
  const elapsed = timestamp - startTime;

  ctx.clearRect(0, 0, W, H);

  // Draw frame based on elapsed time
  // ...

  animationId = requestAnimationFrame(animate);
}

animationId = requestAnimationFrame(animate);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && animationId) {
    cancelAnimationFrame(animationId);
  } else if (!document.hidden) {
    animationId = requestAnimationFrame(animate);
  }
});
\`\`\`

## SVG Illustration Patterns
For static or simple animated illustrations, prefer SVG over canvas:

\`\`\`html
<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg"
     style="width: 100%; height: auto;">
  <!-- Light background -->
  <rect width="400" height="300" fill="#FAFAFA" rx="12" />

  <!-- Decorative shapes (monochrome) -->
  <circle cx="200" cy="150" r="60" fill="#F5F5F5" />
  <circle cx="200" cy="150" r="40" fill="#E5E5E5" />

  <!-- Simple icon paths -->
  <path d="M 180 140 L 200 120 L 220 140 L 220 170 L 180 170 Z"
        fill="#000000" />

  <!-- CSS animation on SVG elements -->
  <style>
    @keyframes pulse {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 1; }
    }
    .animated { animation: pulse 2s ease-in-out infinite; }
  </style>
  <circle cx="200" cy="150" r="80" fill="none"
          stroke="#D4D4D4" stroke-width="1" class="animated" />
</svg>
\`\`\`

## Color Usage for Art
Use the monochrome palette for illustrations:
- Primary shapes: #000000, #1A1A1A
- Secondary shapes: #525252, #737373
- Light fills: #F5F5F5, #FAFAFA
- Borders/lines: #E5E5E5, #D4D4D4
- Accents (sparingly): use warm gradient placeholders for focal areas
  - linear-gradient(135deg, #B8956A, #D4B896)
  - linear-gradient(135deg, #A0926B, #C4B89A)

## Performance Limits
- **Canvas**: max 800x600 resolution, limit to 1000 draw operations per frame
- **Animation**: target 30fps for complex scenes, 60fps only for simple ones
- **SVG**: max 200 elements per illustration
- **Particles**: max 100 simultaneous particles
- Always include visibility change handler to pause offscreen animations
- Avoid setInterval — always use requestAnimationFrame for animations
`;
