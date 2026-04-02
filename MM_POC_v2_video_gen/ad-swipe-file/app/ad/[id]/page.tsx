'use client';

import { useState, useEffect, use } from 'react';
import Link from 'next/link';
import { PLATFORMS, FORMATS, HOOK_ANGLES, CTAS } from '@/lib/constants';
import type { Ad, AiAnalysis } from '@/types';

export default function AdDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [ad, setAd] = useState<Ad | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ brand: '', platform: '', format: '', hook_angle: '', cta: '', campaign: '', notes: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/ads/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setAd(data);
        setForm({
          brand: data.brand || '',
          platform: data.platform || '',
          format: data.format || '',
          hook_angle: data.hook_angle || '',
          cta: data.cta || '',
          campaign: data.campaign || '',
          notes: data.notes || '',
        });
      });
  }, [id]);

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch(`/api/ads/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    });
    const updated = await res.json();
    setAd(updated);
    setEditing(false);
    setSaving(false);
  };

  if (!ad) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin text-2xl" style={{ color: 'var(--accent)' }}>&#9696;</div>
      </div>
    );
  }

  const analysis: AiAnalysis | null = ad.ai_analysis
    ? (() => { try { return JSON.parse(ad.ai_analysis); } catch { return null; } })()
    : null;

  return (
    <div className="max-w-5xl mx-auto p-8">
      <Link href="/search" className="text-sm mb-4 inline-block hover:opacity-80" style={{ color: 'var(--accent)' }}>
        &larr; Back to Search
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Media */}
        <div>
          <div className="rounded-xl overflow-hidden bg-black">
            {ad.media_type === 'video' ? (
              <video src={`/api/assets/${ad.sha256}`} controls className="w-full" />
            ) : (
              <img src={`/api/assets/${ad.sha256}`} alt={ad.filename} className="w-full object-contain" />
            )}
          </div>
          <p className="text-xs mt-2" style={{ color: 'var(--muted)' }}>{ad.filename}</p>
        </div>

        {/* Metadata */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl font-bold" style={{ color: 'var(--foreground)' }}>
              {ad.brand || 'Untitled Creative'}
            </h1>
            <div className="flex gap-2">
              {ad.indexed === 1 && (
                <span className="text-xs px-2 py-1 rounded font-medium" style={{ color: 'var(--accent)', background: 'rgba(99,102,241,0.15)' }}>
                  Indexed
                </span>
              )}
              {!editing ? (
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs px-3 py-1 rounded"
                  style={{ background: 'var(--border)', color: 'var(--foreground)' }}
                >
                  Edit
                </button>
              ) : (
                <div className="flex gap-2">
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs px-3 py-1 rounded text-white"
                    style={{ background: 'var(--accent)' }}
                  >
                    {saving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => setEditing(false)}
                    className="text-xs px-3 py-1 rounded"
                    style={{ background: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          </div>

          {editing ? (
            <div className="space-y-3">
              <EditInput label="Brand" value={form.brand} onChange={(v) => setForm({ ...form, brand: v })} />
              <EditSelect label="Platform" value={form.platform} options={PLATFORMS} onChange={(v) => setForm({ ...form, platform: v })} />
              <EditSelect label="Format" value={form.format} options={FORMATS} onChange={(v) => setForm({ ...form, format: v })} />
              <EditSelect label="Hook Angle" value={form.hook_angle} options={HOOK_ANGLES} onChange={(v) => setForm({ ...form, hook_angle: v })} />
              <EditSelect label="CTA" value={form.cta} options={CTAS} onChange={(v) => setForm({ ...form, cta: v })} />
              <EditInput label="Campaign" value={form.campaign} onChange={(v) => setForm({ ...form, campaign: v })} />
              <div>
                <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none"
                  style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
                />
              </div>
            </div>
          ) : (
            <>
              {/* Display metadata */}
              <div className="grid grid-cols-2 gap-px rounded-lg overflow-hidden mb-6" style={{ background: 'var(--border)' }}>
                <MetaCell label="Platform" value={ad.platform || '—'} />
                <MetaCell label="Format" value={ad.format || '—'} />
                <MetaCell label="Hook Angle" value={ad.hook_angle?.replace(/_/g, ' ') || '—'} />
                <MetaCell label="CTA" value={ad.cta?.replace(/_/g, ' ') || '—'} />
                <MetaCell label="Campaign" value={ad.campaign || '—'} />
                <MetaCell label="Created" value={ad.created_at ? new Date(ad.created_at).toLocaleDateString() : '—'} />
              </div>

              {ad.notes && (
                <div className="mb-6">
                  <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Notes</h3>
                  <p className="text-sm" style={{ color: 'var(--foreground)' }}>{ad.notes}</p>
                </div>
              )}

              {analysis && (
                <div className="space-y-4">
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--foreground)' }}>AI Analysis</h3>
                  <AnalysisBlock label="Layout" value={analysis.layout} />
                  <AnalysisBlock label="Imagery" value={analysis.imagery} />
                  <AnalysisBlock label="Headline" value={analysis.headline} />
                  <AnalysisBlock label="Offer" value={analysis.offer} />
                  <AnalysisBlock label="Hook" value={analysis.hook} />
                  <AnalysisBlock label="Summary" value={analysis.summary} />
                  <AnalysisBlock label="Visual Description" value={analysis.visual_description} />
                  <AnalysisBlock label="Target Audience" value={analysis.target_audience} />
                  <AnalysisBlock label="Emotional Appeal" value={analysis.emotional_appeal} />
                  <AnalysisBlock label="CTA Description" value={analysis.cta_description} />
                  <AnalysisBlock label="Platform Fit" value={analysis.platform_fit} />
                  <AnalysisBlock label="Structure" value={analysis.structure} />
                  <AnalysisBlock label="Search Tags" value={analysis.search_tags} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function MetaCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="p-3" style={{ background: 'var(--card-bg)' }}>
      <div className="text-xs font-semibold mb-0.5" style={{ color: 'var(--muted)' }}>{label}</div>
      <div className="text-sm capitalize" style={{ color: 'var(--foreground)' }}>{value}</div>
    </div>
  );
}

function AnalysisBlock({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="rounded-lg p-3" style={{ background: 'var(--card-bg)' }}>
      <div className="text-xs font-semibold mb-1" style={{ color: 'var(--accent)' }}>{label}</div>
      <p className="text-sm" style={{ color: 'var(--foreground)' }}>{value}</p>
    </div>
  );
}

function EditInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</label>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      />
    </div>
  );
}

function EditSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</label>
      <select
        value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none"
        style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
