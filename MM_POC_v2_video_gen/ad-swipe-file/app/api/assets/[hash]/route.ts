import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const ASSETS_DIR = path.join(process.cwd(), 'data', 'assets');

const MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ hash: string }> }
) {
  const { hash } = await params;

  // Find the file with any extension
  const files = fs.readdirSync(ASSETS_DIR).filter((f) => f.startsWith(hash));
  if (files.length === 0) {
    return NextResponse.json({ error: 'Asset not found' }, { status: 404 });
  }

  const filename = files[0];
  const filePath = path.join(ASSETS_DIR, filename);
  const ext = path.extname(filename).toLowerCase();
  const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

  const buffer = fs.readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}
