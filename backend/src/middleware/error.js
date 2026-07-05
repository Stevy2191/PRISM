// Consistent error handling. All errors surface as:
//   { error: true, message: "...", code: "..." }

class ApiError extends Error {
  constructor(status, message, code, details) {
    super(message);
    this.status = status;
    this.code = code || 'ERROR';
    this.details = details || null;
  }
}

// Wrap async route handlers so thrown/rejected errors reach the error middleware.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// 404 for unmatched API routes.
function notFound(req, res, next) {
  next(new ApiError(404, `Route not found: ${req.method} ${req.originalUrl}`, 'NOT_FOUND'));
}

// Central error handler.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let status = err.status || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'Internal server error';

  // Map common Sequelize errors to clean responses.
  if (err.name === 'SequelizeValidationError' || err.name === 'SequelizeUniqueConstraintError') {
    status = 400;
    code = 'VALIDATION_ERROR';
    message = err.errors?.map((e) => e.message).join('; ') || message;
  } else if (err.name === 'SequelizeForeignKeyConstraintError') {
    status = 400;
    code = 'FK_CONSTRAINT';
    message = 'Referenced record does not exist or is still in use';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    status = 400;
    code = 'FILE_TOO_LARGE';
    message = 'File exceeds the 25MB limit';
  }

  if (status >= 500) {
    console.error('[error]', err);
    // Unexpected (non-ApiError) failures may carry internal details (file
    // paths, driver messages); log them but don't hand them to the client.
    if (!(err instanceof ApiError)) {
      message = 'Internal server error';
    }
  }

  res.status(status).json({ error: true, message, code, ...(err.details || {}) });
}

module.exports = { ApiError, asyncHandler, notFound, errorHandler };
