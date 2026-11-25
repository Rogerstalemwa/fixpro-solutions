import crypto from 'node:crypto';
import { config } from '../config.js';
import { ApiError } from './http.js';

const hash = (code, id) => crypto.createHmac('sha256', config.jwtAccessSecret).update(`${id}:${code}`).digest('hex');

// Six-digit one-time codes for verification and password recovery. Only a keyed hash is stored.
export async function issueCode(db, { userId, channel, target, purpose, ttlMinutes }) {
  const recent = await db.verificationCode.findFirst({ where: { userId, purpose, channel, createdAt: { gt: new Date(Date.now() - 60_000) } } });
  if (recent) throw new ApiError(429, 'Please wait a minute before asking for another code.');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
  const id = crypto.randomUUID();
  await db.verificationCode.create({ data: { id, userId, channel, target, purpose, codeHash: hash(code, id), expiresAt: new Date(Date.now() + ttlMinutes * 60_000) } });
  return code;
}

export async function checkCode(db, { userId, channel, purpose, code }) {
  const rec = await db.verificationCode.findFirst({ where: { userId, channel, purpose, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!rec || rec.attempts >= 5) throw new ApiError(422, 'That code has expired. Request a new one.');
  const good = crypto.timingSafeEqual(Buffer.from(hash(String(code), rec.id)), Buffer.from(rec.codeHash));
  await db.verificationCode.update({ where: { id: rec.id }, data: { attempts: { increment: 1 }, ...(good && { usedAt: new Date() }) } });
  if (!good) throw new ApiError(422, 'That code is not correct.');
  return rec;
}
