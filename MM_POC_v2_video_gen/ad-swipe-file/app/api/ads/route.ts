import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';
import fs from 'fs/promises';
import path from 'path';

const ASSETS_DIR = path.join(process.cwd(), 'data', 'assets');

export async function GET(request: NextRequest) {
  const db = getDb();
  const { searchParams } = request.nextUrl;

  const platform = searchParams.get('platform') || '';
  const format = searchParams.get('format') || '';
  const hook_angle = searchParams.get('hook_angle') || '';
  const cta = searchParams.get('cta') || '';

  let query = 'SELECT * FROM ads WHERE 1=1';
  const params: string[] = [];

  if (platform) { query += ' AND platform = ?'; params.push(platform); }
  if (format) { query += ' AND format = ?'; params.push(format); }
  if (hook_angle) { query += ' AND hook_angle = ?'; params.push(hook_angle); }
  if (cta) { query += ' AND cta = ?'; params.push(cta); }

  query += ' ORDER BY created_at DESC';

  const ads = db.prepare(query).all(...params);
  return NextResponse.json(ads);
}

export async function DELETE() {
  const db = getDb();

  // Count existing records
  const { count } = db.prepare('SELECT COUNT(*) as count FROM ads').get() as { count: number };

  // Delete all records from the ads table
  db.prepare('DELETE FROM ads').run();

  // Reset the autoincrement counter
  db.prepare("DELETE FROM sqlite_sequence WHERE name = 'ads'").run();

  // Delete all asset files
  let filesDeleted = 0;
  try {
    const files = await fs.readdir(ASSETS_DIR);
    for (const file of files) {
      await fs.unlink(path.join(ASSETS_DIR, file));
      filesDeleted++;
    }
  } catch (e) {
    // Assets dir may not exist yet, that's fine
  }

  return NextResponse.json({
    records_deleted: count,
    files_deleted: filesDeleted,
  });
}
