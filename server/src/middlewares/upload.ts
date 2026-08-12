import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { env } from '../config/env';
import { ApiError } from '../utils/ApiError';

fs.mkdirSync(env.uploads.dir, { recursive: true });

const ALLOWED = new Map([
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp'],
]);

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, env.uploads.dir),
  filename: (_req, file, cb) => {
    const ext = ALLOWED.get(file.mimetype) ?? path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
  },
});

/** Single maintenance-ticket photo (SRS 3.1.5). */
export const ticketImageUpload = multer({
  storage,
  limits: { fileSize: env.uploads.maxBytes, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(ApiError.badRequest('Only JPEG, PNG or WebP images are accepted'));
    }
    cb(null, true);
  },
}).single('image');

export function publicUrlFor(filename: string) {
  return `${env.uploads.publicBaseUrl}/${filename}`;
}
