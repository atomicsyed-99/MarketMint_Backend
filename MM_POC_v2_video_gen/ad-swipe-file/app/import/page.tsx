'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { PLATFORMS, FORMATS, HOOK_ANGLES, CTAS } from '@/lib/constants';

export default function ImportPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState('');
  const [metadata, setMetadata] = useState({
    brand: '', platform: '', format: '', hook_angle: '', cta: '', campaign: '', notes: '',
  });

  const handleFileChange = (f: File | null) => {
    setFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setPreview(url);
    } else {
      setPreview(null);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFileChange(f);
  };

  const handleSubmit = async () => {
    if (!file) return;
    setUploading(true);
    setMessage('');

    const formData = new FormData();
    formData.append('file', file);
    Object.entries(metadata).forEach(([k, v]) => formData.append(k, v));

    const res = await fetch('/api/upload', { method: 'POST', body: formData });
    const data = await res.json();

    if (data.duplicate) {
      setMessage('This file already exists in the library.');
    } else if (data.id) {
      setMessage('Uploaded successfully!');
      setTimeout(() => router.push(`/ad/${data.id}`), 1000);
    } else {
      setMessage('Upload failed.');
    }
    setUploading(false);
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-xl font-bold mb-6" style={{ color: 'var(--foreground)' }}>Import Creative</h1>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        onClick={() => fileInputRef.current?.click()}
        className="border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-6"
        style={{
          borderColor: file ? 'var(--accent)' : 'var(--border)',
          background: 'var(--card-bg)',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
        />
        {preview ? (
          <div className="flex flex-col items-center gap-3">
            <img src={preview} alt="Preview" className="max-h-48 rounded-lg object-contain" />
            <p className="text-sm" style={{ color: 'var(--muted)' }}>{file?.name}</p>
          </div>
        ) : (
          <div>
            <p className="text-sm mb-1" style={{ color: 'var(--foreground)' }}>
              Drop file here or click to browse
            </p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              PNG, JPG, WEBP, MP4, MOV
            </p>
          </div>
        )}
      </div>

      {/* Metadata Form */}
      <div className="space-y-4 mb-6">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Brand" value={metadata.brand} onChange={(v) => setMetadata({ ...metadata, brand: v })} />
          <Input label="Campaign" value={metadata.campaign} onChange={(v) => setMetadata({ ...metadata, campaign: v })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Platform" value={metadata.platform} options={PLATFORMS.filter(o => o.value !== '')} onChange={(v) => setMetadata({ ...metadata, platform: v })} />
          <Select label="Format" value={metadata.format} options={FORMATS.filter(o => o.value !== '')} onChange={(v) => setMetadata({ ...metadata, format: v })} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Hook Angle" value={metadata.hook_angle} options={HOOK_ANGLES.filter(o => o.value !== '')} onChange={(v) => setMetadata({ ...metadata, hook_angle: v })} />
          <Select label="CTA" value={metadata.cta} options={CTAS.filter(o => o.value !== '')} onChange={(v) => setMetadata({ ...metadata, cta: v })} />
        </div>
        <div>
          <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>Notes</label>
          <textarea
            value={metadata.notes}
            onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
            rows={3}
            className="w-full rounded-lg px-3 py-2 text-sm resize-none outline-none"
            style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
          />
        </div>
      </div>

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={!file || uploading}
        className="w-full py-3 rounded-lg text-sm font-medium text-white transition-colors"
        style={{
          background: !file || uploading ? 'var(--border)' : 'var(--accent)',
          cursor: !file || uploading ? 'not-allowed' : 'pointer',
        }}
      >
        {uploading ? 'Uploading...' : 'Upload Creative'}
      </button>

      {message && (
        <p className="mt-3 text-sm text-center" style={{ color: message.includes('success') ? 'var(--success)' : 'var(--muted)' }}>
          {message}
        </p>
      )}
    </div>
  );
}

function Input({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
        style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      />
    </div>
  );
}

function Select({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: readonly { value: string; label: string }[];
}) {
  return (
    <div>
      <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--muted)' }}>{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg px-3 py-2 text-sm outline-none appearance-none"
        style={{ background: 'var(--background)', border: '1px solid var(--border)', color: 'var(--foreground)' }}
      >
        <option value="">Select...</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  );
}
