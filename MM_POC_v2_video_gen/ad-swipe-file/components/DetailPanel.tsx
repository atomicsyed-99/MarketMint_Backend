'use client';

import Link from 'next/link';
import type { SearchResult } from '@/types';
import type { AiAnalysis } from '@/types';

interface DetailPanelProps {
  ad: SearchResult;
}

export default function DetailPanel({ ad }: DetailPanelProps) {
  const analysis: AiAnalysis | null = ad.ai_analysis
    ? (() => { try { return JSON.parse(ad.ai_analysis); } catch { return null; } })()
    : null;

  return (
    <div className="h-full overflow-y-auto p-4" style={{ background: 'var(--card-bg)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>DETAIL</h2>
          <p className="text-sm font-medium" style={{ color: 'var(--foreground)' }}>
            {ad.brand || ad.filename.slice(0, 30)}
          </p>
        </div>
        <Link
          href={`/ad/${ad.id}`}
          className="text-xs px-2 py-1 rounded hover:opacity-80"
          style={{ color: 'var(--accent)' }}
        >
          Open
        </Link>
      </div>

      {/* Image */}
      <div className="rounded-lg overflow-hidden mb-4 bg-black">
        <img
          src={`/api/assets/${ad.sha256}`}
          alt={ad.filename}
          className="w-full object-contain max-h-64"
        />
      </div>

      {/* Brand + Description */}
      <p className="text-sm mb-1 font-medium" style={{ color: 'var(--foreground)' }}>
        {ad.brand || 'Unknown Brand'}
      </p>
      <p className="text-xs mb-4" style={{ color: 'var(--muted)' }}>
        {analysis?.summary || ad.notes || 'No description available.'}
      </p>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-px rounded-lg overflow-hidden mb-4" style={{ background: 'var(--border)' }}>
        <MetaCell label="PLATFORM" value={ad.platform || '—'} />
        <MetaCell label="FORMAT" value={ad.format || '—'} />
        <MetaCell label="HOOK" value={analysis?.hook?.slice(0, 120) || ad.hook_angle || '—'} />
        <MetaCell label="CTA" value={formatCta(ad.cta) || '—'} />
        <MetaCell label="CAMPAIGN" value={ad.campaign || '—'} />
        <MetaCell label="CREATED" value={ad.created_at ? new Date(ad.created_at).toLocaleDateString() : '—'} />
      </div>

      {/* Notes */}
      {ad.notes && (
        <div className="mb-4">
          <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>NOTES</h3>
          <p className="text-xs" style={{ color: 'var(--foreground)' }}>{ad.notes}</p>
        </div>
      )}

      {/* AI Analysis */}
      {analysis && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>AI ANALYSIS</h3>
          <AnalysisField label="Layout" value={analysis.layout} />
          <AnalysisField label="Imagery" value={analysis.imagery} />
          <AnalysisField label="Headline" value={analysis.headline} />
          <AnalysisField label="Offer" value={analysis.offer} />
          <AnalysisField label="Target Audience" value={analysis.target_audience} />
          <AnalysisField label="Emotional Appeal" value={analysis.emotional_appeal} />
          <AnalysisField label="Platform Fit" value={analysis.platform_fit} />
          <AnalysisField label="Structure" value={analysis.structure} />
          <AnalysisField label="CTA Description" value={analysis.cta_description} />
          <AnalysisField label="Search Tags" value={analysis.search_tags} />
        </div>
      )}
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3" style={{ background: 'var(--background)' }}>
      <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="text-xs" style={{ color: 'var(--foreground)' }}>{value}</div>
    </div>
  );
}

function AnalysisField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <p className="text-xs" style={{ color: 'var(--foreground)' }}>{value}</p>
    </div>
  );
}

function formatCta(cta: string): string {
  return cta.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
