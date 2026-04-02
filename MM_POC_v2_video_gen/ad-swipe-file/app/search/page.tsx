'use client';

import { useState, useEffect, useCallback } from 'react';
import SearchSidebar from '@/components/SearchSidebar';
import AdCard from '@/components/AdCard';
import DetailPanel from '@/components/DetailPanel';
import type { SearchResult } from '@/types';

export default function SearchPage() {
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState({ platform: '', format: '', hook_angle: '', cta: '' });
  const [results, setResults] = useState<SearchResult[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchAds = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery?.trim()) params.set('q', searchQuery);
    if (filters.platform) params.set('platform', filters.platform);
    if (filters.format) params.set('format', filters.format);
    if (filters.hook_angle) params.set('hook_angle', filters.hook_angle);
    if (filters.cta) params.set('cta', filters.cta);

    const endpoint = searchQuery?.trim() ? '/api/search' : '/api/ads';
    const res = await fetch(`${endpoint}?${params}`);
    const data = await res.json();

    const scored = Array.isArray(data)
      ? data.map((ad: SearchResult) => ({ ...ad, score: ad.score || 0 }))
      : [];

    setResults(scored);
    setLoading(false);
  }, [filters]);

  const fetchTotal = useCallback(async () => {
    const res = await fetch('/api/ads');
    const data = await res.json();
    if (Array.isArray(data)) setTotalCount(data.length);
  }, []);

  useEffect(() => {
    fetchAds();
    fetchTotal();
  }, [fetchAds, fetchTotal]);

  const handleSearch = () => fetchAds(query);

  const handleReset = () => {
    setQuery('');
    setFilters({ platform: '', format: '', hook_angle: '', cta: '' });
    setSelectedId(null);
    fetchAds();
  };

  const handleFilterChange = (key: string, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  };

  // Re-fetch when filters change
  useEffect(() => {
    fetchAds(query || undefined);
  }, [filters, fetchAds, query]);

  const handleDeleteAll = async () => {
    if (!confirm('Delete all ads and reset the database? You will need to re-sync after this.')) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/ads', { method: 'DELETE' });
      const data = await res.json();
      console.log('Delete result:', data);
      setResults([]);
      setTotalCount(0);
      setSelectedId(null);
    } catch (e) {
      console.error('Delete failed:', e);
    }
    setDeleting(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await fetch('/api/sync', { method: 'POST' });
      await fetchAds(query || undefined);
      await fetchTotal();
    } catch (e) {
      console.error('Sync failed:', e);
    }
    setSyncing(false);
  };

  const selectedAd = results.find((r) => r.id === selectedId) || null;

  return (
    <div className="flex h-full">
      {/* Left Sidebar */}
      <div className="w-56 flex-shrink-0">
        <SearchSidebar
          query={query}
          onQueryChange={setQuery}
          filters={filters}
          onFilterChange={handleFilterChange}
          onSearch={handleSearch}
          onReset={handleReset}
          onSync={handleSync}
          onDeleteAll={handleDeleteAll}
          syncing={syncing}
          deleting={deleting}
          totalCount={totalCount}
          showingCount={results.length}
        />
      </div>

      {/* Center Grid */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mb-3">
          <h2 className="text-base font-semibold" style={{ color: 'var(--foreground)' }}>
            {query ? 'Results' : 'Recent'}
          </h2>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            {results.length} creatives{query ? ` matching "${query}"` : ' in archive'}
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin text-2xl" style={{ color: 'var(--accent)' }}>&#9696;</div>
          </div>
        ) : results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20">
            <p className="text-sm mb-2" style={{ color: 'var(--muted)' }}>No creatives found</p>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              Click &quot;Sync &amp; Analyze&quot; to import images from the source folder
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3">
            {results.map((ad) => (
              <AdCard
                key={ad.id}
                ad={ad}
                selected={ad.id === selectedId}
                onClick={() => setSelectedId(ad.id === selectedId ? null : ad.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right Detail Panel */}
      {selectedAd && (
        <div className="w-80 flex-shrink-0 border-l" style={{ borderColor: 'var(--border)' }}>
          <DetailPanel ad={selectedAd} />
        </div>
      )}
    </div>
  );
}
