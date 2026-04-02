import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/db';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(Number(id));
  if (!ad) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(ad);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  const body = await request.json();

  const allowedFields = ['brand', 'platform', 'format', 'hook_angle', 'cta', 'campaign', 'notes'];
  const updates: string[] = [];
  const values: string[] = [];

  for (const field of allowedFields) {
    if (field in body) {
      updates.push(`${field} = ?`);
      values.push(body[field]);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  updates.push("updated_at = datetime('now')");
  values.push(String(id));

  db.prepare(`UPDATE ads SET ${updates.join(', ')} WHERE id = ?`).run(...values);

  const ad = db.prepare('SELECT * FROM ads WHERE id = ?').get(Number(id));
  return NextResponse.json(ad);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const db = getDb();
  db.prepare('DELETE FROM ads WHERE id = ?').run(Number(id));
  return NextResponse.json({ deleted: true });
}
