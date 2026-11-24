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

export const removeFiles = (paths) => Promise.all(paths.filter(Boolean).map((p) => fs.unlink(p).catch(() => {})));
