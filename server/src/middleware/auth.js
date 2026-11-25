import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { ApiError } from '../lib/http.js';

export const STAFF_ROLES = ['OPERATIONS_ADMIN', 'TECHNICAL_SUPERVISOR', 'FINANCE_ADMIN', 'SUPER_ADMIN'];
export const isStaff = (user) => user.roles.some((r) => STAFF_ROLES.includes(r));

export const authenticate = (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new ApiError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtAccessSecret);
    req.user = { id: payload.sub, roles: payload.roles || [] };
    next();
  } catch {
    next(new ApiError(401, 'Your session has expired. Please sign in again.'));
  }
};

// SUPER_ADMIN passes every role check.
export const requireRole = (...roles) => (req, _res, next) => {
  const allowed = req.user.roles.includes('SUPER_ADMIN') || roles.some((r) => req.user.roles.includes(r));
  next(allowed ? undefined : new ApiError(403, 'Permission denied'));
};
