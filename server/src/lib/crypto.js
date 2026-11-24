import crypto from 'node:crypto';
import { config } from '../config.js';

const key = Buffer.from(config.ninKeyHex, 'hex');

// AES-256-GCM. Output: iv.tag.ciphertext (base64 parts).
export const encryptText = (plain) => {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
};

export const decryptText = (blob) => {
  const [iv, tag, enc] = blob.split('.').map((p) => Buffer.from(p, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
};

// Deterministic keyed hash: lets us enforce one account per NIN without storing it in the clear.
export const hashNin = (nin) => crypto.createHmac('sha256', key).update(`nin:${nin}`).digest('hex');
