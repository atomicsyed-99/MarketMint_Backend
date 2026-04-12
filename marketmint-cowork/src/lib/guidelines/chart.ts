export const CHART = `
# Module: Chart

## Chart.js v4 Setup
Load Chart.js from CDN in your <script> block:
\`\`\`html
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script>
  const ctx = document.getElementById('myChart').getContext('2d');
  new Chart(ctx, { /* config */ });
</script>
\`\`\`

Always set \`<canvas>\` with explicit width/height attributes or use a responsive container:
\`\`\`html
<div style="position: relative; width: 100%; max-width: 600px;">
  <canvas id="myChart"></canvas>
</div>
\`\`\`

## Color Assignment
Use the monochrome palette for datasets. Assign in this priority order:
1. Primary: #000000 (black)
2. Secondary: #525252
3. Tertiary: #737373
4. Quaternary: #A3A3A3
5. Light: #D4D4D4

For area fills, use 10% opacity versions:
- #0000001a, #5252521a, #7373731a, #A3A3A31a, #D4D4D41a

When more color distinction is needed (e.g. 3+ datasets that must be visually separated), use status colors sparingly:
- #000000 (primary), #2563EB (blue), #16A34A (green), #EA580C (orange), #DC2626 (red)

## Legend Configuration
\`\`\`js
legend: {
  position: 'bottom',
  labels: {
    usePointStyle: true,
    pointStyle: 'circle',
    padding: 16,
    font: { family: 'Inter, system-ui', size: 12 },
    color: '#525252'
  }
}
\`\`\`

## Axes Configuration
\`\`\`js
scales: {
  x: {
    grid: { display: false },
    ticks: { font: { family: 'Inter, system-ui', size: 11 }, color: '#737373' },
    border: { display: false }
  },
  y: {
    grid: { color: '#F5F5F5' },
    ticks: { font: { family: 'Inter, system-ui', size: 11 }, color: '#737373' },
    border: { display: false }
  }
}
\`\`\`

## Tooltip Configuration
\`\`\`js
tooltip: {
  backgroundColor: '#000000',
  titleColor: '#FFFFFF',
  bodyColor: '#FFFFFF',
  titleFont: { family: 'Inter, system-ui', size: 12, weight: '500' },
  bodyFont: { family: 'Inter, system-ui', size: 12 },
  padding: 8,
  cornerRadius: 8,
  displayColors: true
}
\`\`\`

## Number Formatting
- Thousands: format as "12.5K" (one decimal)
- Millions: format as "1.2M" (one decimal)
- Currency: "$1,234" or "$12.5K" for large values
- Percentages: "45.2%" (one decimal)
- Use Intl.NumberFormat for locale-aware formatting when possible

Helper function:
\`\`\`js
function fmtNum(n) {
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}
\`\`\`

## Chart Type Configurations

### Line Chart
\`\`\`js
{
  type: 'line',
  data: { labels, datasets: [{ data, borderColor: '#000000', backgroundColor: '#0000000d', fill: true, tension: 0.3, pointRadius: 0, borderWidth: 2 }] },
  options: { responsive: true, plugins: { legend, tooltip }, scales }
}
\`\`\`

### Bar Chart
\`\`\`js
{
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: '#000000', borderRadius: 4, barPercentage: 0.7 }] },
  options: { responsive: true, plugins: { legend, tooltip }, scales }
}
\`\`\`

### Doughnut Chart
\`\`\`js
{
  type: 'doughnut',
  data: { labels, datasets: [{ data, backgroundColor: ['#000000', '#525252', '#737373', '#A3A3A3', '#D4D4D4'], borderWidth: 0 }] },
  options: { responsive: true, cutout: '70%', plugins: { legend: { position: 'bottom' } } }
}
\`\`\`

### Stacked Bar
\`\`\`js
{
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: '#000000', stack: 'stack0' }, { data, backgroundColor: '#A3A3A3', stack: 'stack0' }] },
  options: { responsive: true, scales: { x: { stacked: true }, y: { stacked: true } } }
}
\`\`\`

## Dashboard Layout Pattern
Recommended structure for data dashboards:
1. **Top row**: 3-4 KPI cards (use mockup module CSS)
2. **Large chart**: full-width line or bar chart showing primary trend
3. **Bottom row**: two smaller charts side-by-side (e.g., doughnut + bar)

\`\`\`html
<div class="dashboard">
  <div class="kpi-row"><!-- KPI cards --></div>
  <div class="chart-large"><canvas id="mainChart"></canvas></div>
  <div class="chart-row">
    <div class="chart-half"><canvas id="chart1"></canvas></div>
    <div class="chart-half"><canvas id="chart2"></canvas></div>
  </div>
</div>
\`\`\`
`;
