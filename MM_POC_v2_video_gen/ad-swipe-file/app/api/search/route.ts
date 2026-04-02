import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import { embedText } from '@/lib/gemini';
import { cosineSimilarity } from '@/lib/embeddings';
import type { Ad, SearchResult } from '@/types';

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;

  const q = searchParams.get('q') || '';
  const platform = searchParams.get('platform') || '';
  const format = searchParams.get('format') || '';
  const hook_angle = searchParams.get('hook_angle') || '';
  const cta = searchParams.get('cta') || '';

  // Build filter query
  let query = 'SELECT * FROM ads WHERE 1=1';
  const params: string[] = [];

  if (platform) { query += ' AND platform = ?'; params.push(platform); }
  if (format) { query += ' AND format = ?'; params.push(format); }
  if (hook_angle) { query += ' AND hook_angle = ?'; params.push(hook_angle); }
  if (cta) { query += ' AND cta = ?'; params.push(cta); }

  const ads = db.prepare(query).all(...params) as Ad[];

  // If no search query, return all filtered results
  if (!q.trim()) {
    const results: SearchResult[] = ads.map((ad) => ({ ...ad, score: 0 }));
    return NextResponse.json(results);
  }

  // Embed the query
  const queryEmbedding = await embedText(q);

  // Score each ad using weighted blend of visual and text similarity
  const VISUAL_WEIGHT = 0.6;
  const TEXT_WEIGHT = 0.4;

  const scored: SearchResult[] = ads
    .filter((ad) => ad.embedding_visual || ad.embedding_text)
    .map((ad) => {
      let visualScore = 0;
      let textScore = 0;

      if (ad.embedding_visual) {
        const visualEmb = JSON.parse(ad.embedding_visual) as number[];
        visualScore = cosineSimilarity(queryEmbedding, visualEmb);
      }

      if (ad.embedding_text) {
        const textEmb = JSON.parse(ad.embedding_text) as number[];
        textScore = cosineSimilarity(queryEmbedding, textEmb);
      }

      const score = VISUAL_WEIGHT * visualScore + TEXT_WEIGHT * textScore;
      return { ...ad, score };
    })
    .sort((a, b) => b.score - a.score);

  return NextResponse.json(scored);
}
