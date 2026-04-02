import { createHash } from 'crypto';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { SUPPORTED_IMAGE_EXTS, SUPPORTED_VIDEO_EXTS } from './constants';

const ASSETS_DIR = path.join(process.cwd(), 'data', 'assets');

export async function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function hashBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export function getMediaType(filename: string): 'image' | 'video' | null {
  const ext = path.extname(filename).toLowerCase();
  if (SUPPORTED_IMAGE_EXTS.includes(ext)) return 'image';
  if (SUPPORTED_VIDEO_EXTS.includes(ext)) return 'video';
  return null;
}

export function getAssetPath(sha256: string, ext: string): string {
  return path.join(ASSETS_DIR, `${sha256}${ext}`);
}

export async function saveAsset(sourcePath: string, sha256: string, ext: string): Promise<string> {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const destPath = getAssetPath(sha256, ext);
  await fs.copyFile(sourcePath, destPath);
  return destPath;
}

export async function saveAssetFromBuffer(buffer: Buffer, sha256: string, ext: string): Promise<string> {
  await fs.mkdir(ASSETS_DIR, { recursive: true });
  const destPath = getAssetPath(sha256, ext);
  await fs.writeFile(destPath, buffer);
  return destPath;
}

export async function listSourceFiles(dirPath: string): Promise<string[]> {
  const entries = await fs.readdir(dirPath);
  const supported = entries.filter((f) => {
    const ext = path.extname(f).toLowerCase();
    return [...SUPPORTED_IMAGE_EXTS, ...SUPPORTED_VIDEO_EXTS].includes(ext);
  });
  return supported.map((f) => path.join(dirPath, f));
}
