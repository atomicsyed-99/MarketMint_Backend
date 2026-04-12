export const INTERACTIVE = `
# Module: Interactive

## Styled Slider
\`\`\`css
.slider-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.slider-group label {
  font-size: 12px;
  color: var(--text-tertiary);
  font-weight: 500;
  display: flex;
  justify-content: space-between;
}

.slider-group label .slider-value {
  color: var(--text);
  font-variant-numeric: tabular-nums;
}

input[type="range"] {
  -webkit-appearance: none;
  appearance: none;
  width: 100%;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  outline: none;
}

input[type="range"]::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
}

input[type="range"]::-moz-range-thumb {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  cursor: pointer;
  border: none;
}
\`\`\`

## Toggle Switch
\`\`\`css
.toggle {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
}

.toggle input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle .track {
  position: absolute;
  inset: 0;
  background: var(--border-input);
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.toggle input:checked + .track {
  background: var(--primary);
}

.toggle .track::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: white;
  border-radius: 50%;
  transition: transform 0.15s ease;
}

.toggle input:checked + .track::after {
  transform: translateX(16px);
}
\`\`\`

Usage:
\`\`\`html
<label class="toggle">
  <input type="checkbox" id="myToggle">
  <span class="track"></span>
</label>
\`\`\`

## Live Calculation Pattern
Use data-bind attributes to wire inputs to outputs without inline handlers:

\`\`\`html
<input type="range" id="price" min="0" max="100" value="50" data-bind="price">
<span data-bind-output="total"></span>

<script>
  document.querySelectorAll('[data-bind]').forEach(input => {
    input.addEventListener('input', recalculate);
  });

  function recalculate() {
    const price = Number(document.querySelector('[data-bind="price"]').value);
    const total = price * 1.1;
    document.querySelector('[data-bind-output="total"]').textContent = total.toFixed(2);
  }

  recalculate();
</script>
\`\`\`

## Tab Component
\`\`\`css
.tabs {
  display: flex;
  gap: 0;
}

.tab-btn {
  padding: 8px 16px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-tertiary);
  background: none;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.tab-btn:hover {
  color: var(--text-secondary);
}

.tab-btn.active {
  color: var(--text);
  border-bottom-color: var(--primary);
}

.tab-panel {
  display: none;
  padding: 16px 0;
}

.tab-panel.active {
  display: block;
}
\`\`\`

## Filter Pills
\`\`\`css
.filter-pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.pill {
  padding: 6px 16px;
  font-size: 14px;
  font-weight: 500;
  border-radius: 9999px;
  border: 1px solid var(--border);
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  cursor: pointer;
  font-family: Inter, system-ui, -apple-system, sans-serif;
  transition: all 0.15s ease;
}

.pill:hover {
  border-color: var(--border-hover);
}

.pill.active {
  background: var(--primary);
  color: var(--primary-text);
  border-color: var(--primary);
}
\`\`\`

Tab switching script:
\`\`\`js
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});
\`\`\`
`;
