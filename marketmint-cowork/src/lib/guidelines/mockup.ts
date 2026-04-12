export const MOCKUP = `
# Module: Mockup

## KPI / Metric Card
\`\`\`css
.kpi-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.kpi-card .label {
  font-size: 12px;
  font-weight: 500;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
}

.kpi-card .value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}

.kpi-card .change {
  font-size: 12px;
  font-weight: 500;
  display: flex;
  align-items: center;
  gap: 4px;
}

.kpi-card .change.positive { color: var(--status-complete); }
.kpi-card .change.negative { color: var(--status-error); }
.kpi-card .change.neutral  { color: var(--text-tertiary); }
\`\`\`

Change indicator arrows:
- Positive: prepend with "\\u2191 " (up arrow)
- Negative: prepend with "\\u2193 " (down arrow)
- Neutral: prepend with "\\u2192 " (right arrow)

## Stats Row (Inline Metrics)
For compact horizontal metric displays:
\`\`\`css
.stats-row {
  display: flex;
  border: 1px solid var(--border);
  border-radius: 12px;
  overflow: hidden;
}

.stats-row .stat {
  flex: 1;
  padding: 16px 20px;
  border-right: 1px solid var(--border);
}

.stats-row .stat:last-child {
  border-right: none;
}

.stats-row .stat .value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text);
}

.stats-row .stat .label {
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary);
  margin-top: 2px;
}
\`\`\`

## Data Table
\`\`\`css
.data-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.data-table th {
  text-align: left;
  padding: 12px 16px;
  font-weight: 500;
  font-size: 12px;
  letter-spacing: 0.05em;
  color: var(--text-tertiary);
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}

.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.data-table td.secondary {
  color: var(--text-secondary);
}

.data-table tr:hover td {
  background: var(--bg-secondary);
}

/* Right-align numeric columns */
.data-table th.num,
.data-table td.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
\`\`\`

## Badges (Status Text Only)
\`\`\`css
.badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.5;
}

/* Status badges — colored text only, no background */
.badge.complete { color: var(--status-complete); }
.badge.progress { color: var(--status-progress); }
.badge.review   { color: var(--status-review); }
.badge.error    { color: var(--status-error); }
.badge.draft    { color: var(--status-draft); }

/* Neutral chip style (for tags, categories) */
.badge.chip {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
\`\`\`

## Progress Bar
\`\`\`css
.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-tertiary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-bar .fill {
  height: 100%;
  border-radius: 3px;
  background: var(--primary);
  transition: width 0.3s ease;
}
\`\`\`

Usage: \`<div class="progress-bar"><div class="fill" style="width: 65%"></div></div>\`

## Dashboard Layout
\`\`\`css
.dashboard {
  display: flex;
  flex-direction: column;
  gap: 24px;
  padding: 24px 40px;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  color: var(--text);
  background: var(--bg);
}

.kpi-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 16px;
}

.chart-large {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  background: var(--surface);
}

.chart-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chart-half {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 20px;
  background: var(--surface);
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  letter-spacing: -0.01em;
  margin: 0 0 4px 0;
  color: var(--text);
}

.section-subtitle {
  font-size: 12px;
  color: var(--text-tertiary);
  margin: 0 0 16px 0;
}
\`\`\`
`;
