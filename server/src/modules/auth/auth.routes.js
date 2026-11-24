import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { config } from '../../config.js';
import { ApiError, asyncHandler, ok } from '../../lib/http.js';
import { audit } from '../../lib/audit.js';
import { authenticate } from '../../middleware/auth.js';

const router = Router();
router.use(rateLimit({ windowMs: 15 * 60_000, limit: 50, standardHeaders: true, legacyHeaders: false }));

const COOKIE = 'fp_refresh';

// Accepts 0700000000, 256700000000 or +256700000000 and stores +256700000000.
export const normalisePhone = (value) => {
  let d = String(value).replace(/[\s()-]/g, '');
  if (d.startsWith('+')) d = d.slice(1);
  if (d.startsWith('0')) d = `256${d.slice(1)}`;
  return `+${d}`;
};

const phone = z
  .string()
  .trim()
  .transform(normalisePhone)
  .refine((v) => /^\+256\d{9}$/.test(v), 'Enter a valid Ugandan phone number, e.g. 0700 000 000');

const password = z
  .string()
  .min(8, 'Use at least 8 characters')
  .regex(/[A-Za-z]/, 'Include at least one letter')
  .regex(/\d/, 'Include at least one number');

const registerSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name is required').max(120),
  phone,
  email: z.string().trim().toLowerCase().email('Enter a valid email address').optional().or(z.literal('').transform(() => undefined)),
  password,
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Enter your phone number or email'),
  password: z.string().min(1, 'Enter your password'),
});

export const publicUser = (u) => ({
  id: u.id,
  fullName: u.fullName,
  email: u.email,
  phone: u.phone,
  status: u.status,
  roles: u.roles.map((r) => r.role.name),
});

export const withRoles = { roles: { include: { role: true } } };

export const startSession = (res, user) => {
  const roles = user.roles.map((r) => r.role.name);
  const accessToken = jwt.sign({ roles }, config.jwtAccessSecret, { subject: user.id, expiresIn: config.accessTtl });
  const refreshToken = jwt.sign({}, config.jwtRefreshSecret, {
    subject: user.id,
    expiresIn: `${config.refreshTtlDays}d`,
  });
  res.cookie(COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.env === 'production',
    path: '/api/v1/auth',
    maxAge: config.refreshTtlDays * 24 * 60 * 60 * 1000,
  });
  return accessToken;
};

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const body = registerSchema.parse(req.body);
    const clash = await prisma.user.findFirst({
      where: { OR: [{ phone: body.phone }, ...(body.email ? [{ email: body.email }] : [])] },
      select: { id: true },
    });
    if (clash) throw new ApiError(409, 'An account with this phone number or email already exists');

    const passwordHash = await bcrypt.hash(body.password, 12);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName: body.fullName,
          phone: body.phone,
          email: body.email,
          passwordHash,
          status: 'ACTIVE', // no OTP/email verification yet, so customers are active on sign-up
          customer: { create: {} },
          roles: {
            create: { role: { connectOrCreate: { where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' } } } },
          },
        },
        include: withRoles,
      });
      await audit(tx, { userId: created.id, action: 'USER_REGISTERED', entityType: 'User', entityId: created.id, ip: req.ip });
      return created;
    });
    const accessToken = startSession(res, user);
    ok(res, { user: publicUser(user), accessToken }, 'Account created', 201);
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { identifier, password: pw } = loginSchema.parse(req.body);
    const where = identifier.includes('@') ? { email: identifier.toLowerCase() } : { phone: normalisePhone(identifier) };
    const user = await prisma.user.findUnique({ where, include: withRoles });
    const valid = user && (await bcrypt.compare(pw, user.passwordHash));
    if (!valid) throw new ApiError(401, 'Incorrect phone number, email or password');
    if (user.status !== 'ACTIVE') throw new ApiError(403, 'This account is not active. Contact FixPro support.');

    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const accessToken = startSession(res, user);
    ok(res, { user: publicUser(user), accessToken }, 'Signed in');
  })
);

router.post(
  '/refresh',
  asyncHandler(async (req, res) => {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new ApiError(401, 'No active session');
    let sub;
    try {
      sub = jwt.verify(token, config.jwtRefreshSecret).sub;
    } catch {
      throw new ApiError(401, 'Your session has expired. Please sign in again.');
    }
    const user = await prisma.user.findUnique({ where: { id: sub }, include: withRoles });
    if (!user || user.status !== 'ACTIVE') throw new ApiError(401, 'No active session');
    const accessToken = startSession(res, user);
    ok(res, { user: publicUser(user), accessToken });
  })
);

router.post('/logout', authenticate, (_req, res) => {
  res.clearCookie(COOKIE, { path: '/api/v1/auth' });
  ok(res, null, 'Signed out');
});

router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user.id }, include: withRoles });
    if (!user) throw new ApiError(401, 'Account not found');
    ok(res, publicUser(user));
  })
);

// Password reset needs an email/SMS provider. Wired up when notifications are built.
router.post('/forgot-password', (_req, res) =>
  res.status(501).json({ success: false, message: 'Password reset is not available yet' })
);
router.post('/reset-password', (_req, res) =>
  res.status(501).json({ success: false, message: 'Password reset is not available yet' })
);

export default router;
