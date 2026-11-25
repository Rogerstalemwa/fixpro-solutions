import multer from 'multer';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ApiError } from './http.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const UPLOAD_ROOT = path.resolve(process.env.UPLOAD_DIR || path.join(here, '../../uploads'));
export const PHOTO_DIR = path.join(UPLOAD_ROOT, 'photos'); // served publicly (profile photos only)
export const PRIVATE_DIR = path.join(UPLOAD_ROOT, 'private'); // ID documents: never served statically

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 3 * 1024 * 1024, files: 2 } });
// Photos, short videos and documents (25 MB ceiling here; saveFile applies the per-type limit).
export const uploadMedia = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });

// Identify the real image type from its first bytes, not from the client-supplied name or MIME type.
const sniff = (b) => {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP') return 'webp';
  return null;
};

export async function saveImage(file, dir, field, label) {
  if (!file) throw new ApiError(422, 'Validation failed', [{ field, message: `${label} is required` }]);
  const ext = sniff(file.buffer);
  if (!ext) throw new ApiError(422, 'Validation failed', [{ field, message: `${label} must be a JPG, PNG or WebP image under 3 MB` }]);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), file.buffer, { mode: 0o640 });
  return name;
}

const sniffAny = (b) => {
  const image = sniff(b);
  if (image) return image;
  if (b.length < 12) return null;
  if (b.subarray(0, 4).toString() === '%PDF') return 'pdf';
  if (b.subarray(4, 8).toString() === 'ftyp') return 'mp4';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'webm';
  return null;
};
const KIND = { jpg: 'IMAGE', png: 'IMAGE', webp: 'IMAGE', pdf: 'DOCUMENT', mp4: 'VIDEO', webm: 'VIDEO' };
const MAX_MB = { IMAGE: 8, DOCUMENT: 8, VIDEO: 25 };

// Saves an uploaded file after checking its real type and size. Returns { name, kind }.
export async function saveFile(file, dir, { allow, field = 'files', label = 'File' }) {
  const fail = (message) => { throw new ApiError(422, 'Validation failed', [{ field, message }]); };
  const ext = file?.buffer && sniffAny(file.buffer);
  const kind = ext && KIND[ext];
  if (!kind || !allow.includes(kind)) fail(`${label} must be ${allow.map((k) => ({ IMAGE: 'an image (JPG, PNG or WebP)', DOCUMENT: 'a PDF', VIDEO: 'a video (MP4 or WebM)' }[k])).join(' or ')}`);
  if (file.size > MAX_MB[kind] * 1024 * 1024) fail(`${label} is too large. The limit is ${MAX_MB[kind]} MB.`);
  await fs.mkdir(dir, { recursive: true });
  const name = `${crypto.randomUUID()}.${ext}`;
  await fs.writeFile(path.join(dir, name), file.buffer, { mode: 0o640 });
  return { name, kind };
}

export const removeFiles = (paths) => Promise.all(paths.filter(Boolean).map((p) => fs.unlink(p).catch(() => {})));
