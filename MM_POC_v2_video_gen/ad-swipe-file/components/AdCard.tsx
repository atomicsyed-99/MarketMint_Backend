'use client';

import type { SearchResult } from '@/types';

interface AdCardProps {
  ad: SearchResult;
  selected: boolean;
  onClick: () => void;
}

export default function AdCard({ ad, selected, onClick }: AdCardProps) {
  const analysis = ad.ai_analysis ? (() => { try { return JSON.parse(ad.ai_analysis); } catch { return null; } })() : null;
  const description = analysis?.summary || ad.notes || 'No description available.';

  return (
    <div
      onClick={onClick}
      className="cursor-pointer rounded-lg overflow-hidden transition-all"
      style={{
        background: 'var(--card-bg)',
        border: selected ? '2px solid var(--accent)' : '2px solid transparent',
      }}
    >
      {/* Thumbnail */}
      <div className="relative aspect-square overflow-hidden bg-black">
        <img
          src={`/api/assets/${ad.sha256}`}
          alt={ad.filename}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        {ad.media_type === 'video' && ad.duration_secs && (
          <span className="absolute top-2 left-2 bg-black/70 text-white text-xs px-1.5 py-0.5 rounded">
            {formatDuration(ad.duration_secs)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="p-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate" style={{ color: 'var(--foreground)' }}>
            {ad.brand || ad.filename.slice(0, 20)}
          </span>
          {ad.indexed === 1 && (
            <span className="text-xs px-1.5 py-0.5 rounded font-medium" style={{ color: 'var(--accent)', background: 'rgba(99,102,241,0.15)' }}>
              Indexed
            </span>
          )}
        </div>
        <p className="text-xs truncate mb-2" style={{ color: 'var(--muted)' }}>
          {description.slice(0, 80)}
        </p>
        <div className="flex gap-1 flex-wrap">
          {ad.platform && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--muted)' }}>
              {ad.platform}
            </span>
          )}
          {ad.format && (
            <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: 'var(--border)', color: 'var(--muted)' }}>
              {ad.format}
            </span>
          )}
        </div>
        {ad.score > 0 && (
          <div className="mt-2 text-xs" style={{ color: 'var(--accent)' }}>
            {(ad.score * 100).toFixed(1)}% match
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
