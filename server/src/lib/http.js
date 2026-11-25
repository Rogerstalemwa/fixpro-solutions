export class ApiError extends Error {
  constructor(status, message, errors) {
    super(message);
    this.status = status;
    this.errors = errors;
  }
}

export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const ok = (res, data, message = 'OK', status = 200) =>
  res.status(status).json({ success: true, message, data });

export const paginated = (res, data, { page, limit, total }) =>
  res.json({
    success: true,
    data,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  });

export const pageParams = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit, skip: (page - 1) * limit };
};
