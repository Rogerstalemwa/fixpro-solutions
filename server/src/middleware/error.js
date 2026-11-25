import { ZodError } from 'zod';
import { ApiError } from '../lib/http.js';
import { logger } from '../lib/logger.js';

export const notFound = (_req, res) =>
  res.status(404).json({ success: false, message: 'Route not found' });

// eslint-disable-next-line no-unused-vars
export const errorHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    return res.status(422).json({
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  }
  if (err instanceof ApiError) {
    return res
      .status(err.status)
      .json({ success: false, message: err.message, ...(err.errors && { errors: err.errors }) });
  }
  if (err?.name === 'MulterError') {
    const message = err.code === 'LIMIT_FILE_SIZE' ? 'That file is too large' : 'Unexpected file upload';
    return res.status(422).json({ success: false, message, errors: [{ field: err.field || 'file', message }] });
  }
  if (err?.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'A record with these details already exists' });
  }
  if (err?.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON in request body' });
  }
  logger.error(err);
  res.status(500).json({ success: false, message: 'Something went wrong on our side. Please try again.' });
};
