'use client';

import { PLATFORMS, FORMATS, HOOK_ANGLES, CTAS } from '@/lib/constants';

interface SearchSidebarProps {
  query: string;
  onQueryChange: (q: string) => void;
  filters: {
    platform: string;
    format: string;
    hook_angle: string;
    cta: string;
  };
  onFilterChange: (key: string, value: string) => void;
  onSearch: () => void;
  onReset: () => void;
  onSync: () => void;
  onDeleteAll: () => void;
  syncing: boolean;
  deleting: boolean;
  totalCount: number;
  showingCount: number;
}

export default function SearchSidebar({
  query, onQueryChange, filters, onFilterChange,
  onSearch, onReset, onSync, onDeleteAll, syncing, deleting, totalCount, showingCount,
}: SearchSidebarProps) {
  return (
    <div className="h-full flex flex-col p-4 overflow-y-auto" style={{ background: 'var(--card-bg)', borderRight: '1px solid var(--border)' }}>
      {/* Search Input */}
      <textarea
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSearch(); } }}
        placeholder="Describe what you're looking for..."
        rows={4}
        className="w-full rounded-lg px-3 py-2 text-sm resize-none mb-3 outline-none"
        style={{
          background: 'var(--background)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}
      />

      {/* Search / Reset Buttons */}
      <div className="flex gap-2 mb-5">
        <button
          onClick={onSearch}
          className="flex-1 py-2 rounded-lg text-sm font-medium text-white transition-colors"
          style={{ background: 'var(--accent)' }}
        >
          Search
        </button>
        <button
          onClick={onReset}
          className="flex-1 py-2 rounded-lg text-sm font-medium transition-colors"
          style={{ background: 'var(--border)', color: 'var(--foreground)' }}
        >
          Reset
        </button>
      </div>

      {/* Filters */}
      <FilterSelect label="BRAND" value="" onChange={() => {}} options={[{ value: '', label: 'All' }]} disabled />
      <FilterSelect label="PLATFORM" value={filters.platform} onChange={(v) => onFilterChange('platform', v)} options={PLATFORMS} />
      <FilterSelect label="FORMAT" value={filters.format} onChange={(v) => onFilterChange('format', v)} options={FORMATS} />
      <FilterSelect label="HOOK ANGLE" value={filters.hook_angle} onChange={(v) => onFilterChange('hook_angle', v)} options={HOOK_ANGLES} />
      <FilterSelect label="CTA" value={filters.cta} onChange={(v) => onFilterChange('cta', v)} options={CTAS} />

      {/* Spacer */}
      <div className="flex-1" />

      {/* Counts */}
      <div className="flex gap-6 mb-3 mt-4">
        <div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>TOTAL</div>
          <div className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>{totalCount}</div>
        </div>
        <div>
          <div className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>SHOWING</div>
          <div className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>{showingCount}</div>
        </div>
      </div>

      {/* Delete All Button */}
      <button
        onClick={onDeleteAll}
        disabled={deleting || syncing}
        className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 mb-2"
        style={{
          background: deleting ? 'var(--border)' : '#dc2626',
          color: deleting ? 'var(--muted)' : 'white',
          cursor: deleting || syncing ? 'not-allowed' : 'pointer',
        }}
      >
        {deleting ? (
          <>
            <span className="animate-spin">&#9696;</span>
            Deleting...
          </>
        ) : (
          'Delete All & Reset DB'
        )}
      </button>

      {/* Sync Button */}
      <button
        onClick={onSync}
        disabled={syncing || deleting}
        className="w-full py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"
        style={{
          background: syncing ? 'var(--border)' : 'var(--accent)',
          color: syncing ? 'var(--muted)' : 'white',
          cursor: syncing || deleting ? 'not-allowed' : 'pointer',
        }}
      >
        {syncing ? (
          <>
            <span className="animate-spin">&#9696;</span>
            Syncing...
          </>
        ) : (
          '+ Sync & Analyze'
        )}
      </button>
    </div>
  );
}

function FilterSelect({
  label, value, onChange, options, disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
  disabled?: boolean;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none"
        style={{
          background: 'var(--background)',
          border: '1px solid var(--border)',
          color: 'var(--foreground)',
        }}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
