import { NextResponse } from 'next/server';
import path from 'path';
import { getDb } from '@/lib/db';
import { hashBuffer, getMediaType, saveAssetFromBuffer } from '@/lib/media';

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  if (!file) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  const mediaType = getMediaType(file.name);
  if (!mediaType) {
    return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const sha256 = hashBuffer(buffer);
  const ext = path.extname(file.name).toLowerCase();

  const db = getDb();
  const existing = db.prepare('SELECT id FROM ads WHERE sha256 = ?').get(sha256) as { id: number } | undefined;
  if (existing) {
    return NextResponse.json({ id: existing.id, duplicate: true });
  }

  const filePath = await saveAssetFromBuffer(buffer, sha256, ext);

  // Extract optional metadata from form
  const brand = (formData.get('brand') as string) || '';
  const platform = (formData.get('platform') as string) || '';
  const format = (formData.get('format') as string) || '';
  const hook_angle = (formData.get('hook_angle') as string) || '';
  const cta = (formData.get('cta') as string) || '';
  const campaign = (formData.get('campaign') as string) || '';
  const notes = (formData.get('notes') as string) || '';

  const result = db.prepare(`
    INSERT INTO ads (sha256, filename, file_path, media_type, brand, platform, format, hook_angle, cta, campaign, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(sha256, file.name, filePath, mediaType, brand, platform, format, hook_angle, cta, campaign, notes);

  return NextResponse.json({ id: result.lastInsertRowid, duplicate: false });
}
