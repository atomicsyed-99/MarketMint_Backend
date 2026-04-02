import { NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';
import { hashFile, getMediaType, saveAsset, listSourceFiles } from '@/lib/media';
import { analyzeAd, embedText, embedImage } from '@/lib/gemini';
import type { Ad } from '@/types';

export const maxDuration = 300;

const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 5000;

async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt === MAX_RETRIES) throw e;
      const delay = INITIAL_BACKOFF_MS * Math.pow(2, attempt - 1);
      console.warn(`[sync]   ${label} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay / 1000}s... Error: ${e}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error('unreachable');
}

export async function POST() {
  const sourceDir = process.env.IMPORT_SOURCE_DIR;
  if (!sourceDir) {
    return NextResponse.json({ error: 'IMPORT_SOURCE_DIR not configured' }, { status: 500 });
  }

  const db = getDb();
  const results = {
    scanned: 0,
    imported: 0,
    skipped: 0,
    analyzed: 0,
    errors: [] as string[],
  };

  // Phase 1: Scan and import new files
  let files: string[];
  try {
    files = await listSourceFiles(sourceDir);
  } catch (e) {
    return NextResponse.json({ error: `Cannot read source directory: ${e}` }, { status: 500 });
  }

  results.scanned = files.length;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO ads (sha256, filename, file_path, media_type)
    VALUES (?, ?, ?, ?)
  `);

  for (const filePath of files) {
    try {
      const sha256 = await hashFile(filePath);
      const existing = db.prepare('SELECT id FROM ads WHERE sha256 = ?').get(sha256);
      if (existing) {
        results.skipped++;
        continue;
      }

      const filename = path.basename(filePath);
      const ext = path.extname(filePath).toLowerCase();
      const mediaType = getMediaType(filename) || 'image';
      const assetPath = await saveAsset(filePath, sha256, ext);

      insertStmt.run(sha256, filename, assetPath, mediaType);
      results.imported++;
    } catch (e) {
      results.errors.push(`Import ${path.basename(filePath)}: ${e}`);
    }
  }

  // Phase 2: Analyze and embed all unindexed ads
  const unindexed = db.prepare('SELECT * FROM ads WHERE indexed = 0').all() as Ad[];

  const updateStmt = db.prepare(`
    UPDATE ads SET
      ai_analysis = ?,
      brand = CASE WHEN brand = '' THEN ? ELSE brand END,
      platform = CASE WHEN platform = '' THEN ? ELSE platform END,
      format = CASE WHEN format = '' THEN ? ELSE format END,
      hook_angle = CASE WHEN hook_angle = '' THEN ? ELSE hook_angle END,
      cta = CASE WHEN cta = '' THEN ? ELSE cta END,
      embedding_visual = ?,
      embedding_text = ?,
      indexed = 1,
      updated_at = datetime('now')
    WHERE id = ?
  `);

  console.log(`[sync] Phase 2: ${unindexed.length} unindexed ads to process`);

  for (const ad of unindexed) {
    try {
      console.log(`[sync] Processing ad ${ad.id} (${ad.filename}) - file: ${ad.file_path}`);

      // Analyze with Gemini Flash
      console.log(`[sync]   Analyzing with Gemini Flash...`);
      const analysis = await withRetry(() => analyzeAd(ad.file_path), 'Gemini analysis');
      console.log(`[sync]   Analysis OK - summary: ${analysis.summary?.substring(0, 80) || 'EMPTY'}`);

      // Generate visual embedding
      console.log(`[sync]   Generating visual embedding...`);
      const visualEmb = await withRetry(() => embedImage(ad.file_path), 'Visual embedding');
      console.log(`[sync]   Visual embedding OK - ${visualEmb.length} dimensions`);

      // Generate text embedding from analysis fields
      const textForEmbed = [
        analysis.visual_description || '',
        analysis.search_tags || '',
        analysis.imagery || '',
        analysis.layout || '',
        analysis.headline || '',
        analysis.offer || '',
        analysis.hook || '',
        analysis.summary || '',
        analysis.structure || '',
        analysis.emotional_appeal || '',
        analysis.target_audience || '',
        analysis.cta_description || '',
        analysis.suggested_brand || '',
      ].filter(Boolean).join(' ');
      console.log(`[sync]   Generating text embedding from: "${textForEmbed.substring(0, 100)}..."`);
      const textEmb = await withRetry(() => embedText(textForEmbed), 'Text embedding');
      console.log(`[sync]   Text embedding OK - ${textEmb.length} dimensions`);

      updateStmt.run(
        JSON.stringify(analysis),
        analysis.suggested_brand || '',
        analysis.suggested_platform || '',
        analysis.suggested_format || '',
        analysis.suggested_hook_angle || '',
        analysis.suggested_cta || '',
        JSON.stringify(visualEmb),
        JSON.stringify(textEmb),
        ad.id
      );

      results.analyzed++;
      console.log(`[sync]   Ad ${ad.id} fully indexed (${results.analyzed}/${unindexed.length})`);

      // Rate limit: 4s delay between Gemini calls
      await new Promise((r) => setTimeout(r, 4000));
    } catch (e) {
      const errMsg = `Analyze ad ${ad.id} (${ad.filename}): ${e}`;
      console.error(`[sync] ERROR: ${errMsg}`);
      results.errors.push(errMsg);
    }
  }

  console.log(`[sync] Done. Analyzed: ${results.analyzed}, Errors: ${results.errors.length}`);

  return NextResponse.json(results);
}
