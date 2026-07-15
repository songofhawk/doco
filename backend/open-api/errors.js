import { randomUUID } from 'crypto';

export class ApiError extends Error {
  constructor(status, code, message, details, type) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.type = type || errorTypeForStatus(status);
  }
}

function errorTypeForStatus(status) {
  if (status === 401) return 'authentication_error';
  if (status === 403) return 'permission_error';
  if (status === 404) return 'not_found_error';
  if (status === 409) return 'conflict_error';
  if (status === 429) return 'rate_limit_error';
  if (status >= 500) return 'server_error';
  return 'invalid_request_error';
}

export function requestContext(req, res, next) {
  const requested = String(req.get('x-request-id') || '').trim();
  req.requestId = /^[A-Za-z0-9_.:-]{1,128}$/.test(requested) ? requested : `req_${randomUUID()}`;
  res.set('X-Request-Id', req.requestId);
  next();
}

export function sendData(res, data, extra = {}) {
  return res.json({ data, ...extra, request_id: res.req.requestId });
}

export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

export function openApiNotFound(req, _res, next) {
  next(new ApiError(404, 'route_not_found', '接口不存在'));
}

export function openApiErrorHandler(error, req, res, _next) {
  if (res.headersSent) return;
  const inferredStatus = error.code === 'LIMIT_FILE_SIZE' ? 413 : error.type === 'entity.parse.failed' ? 400 : null;
  const status = Number(error.status || error.statusCode || inferredStatus || 500);
  const safeStatus = status >= 400 && status <= 599 ? status : 500;
  const body = {
    error: {
      type: error.type || errorTypeForStatus(safeStatus),
      code: error.code === 'LIMIT_FILE_SIZE' ? 'attachment_too_large' : error.type === 'entity.parse.failed' ? 'invalid_json' : (error.code || (safeStatus >= 500 ? 'internal_error' : 'invalid_request')),
      message: safeStatus >= 500 && !(error instanceof ApiError) ? '服务端内部错误' : (error.message || '请求失败'),
    },
    request_id: req.requestId,
  };
  if (error.details !== undefined) body.error.details = error.details;
  if (safeStatus >= 500) console.error('[OpenAPI]', req.requestId, error);
  res.status(safeStatus).json(body);
}
