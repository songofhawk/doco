import { ApiError } from './errors.js';

export class MemoryRateLimitStore {
  constructor() { this.buckets = new Map(); }
  take(key, capacity, refillPerMs, now = Date.now()) {
    const current = this.buckets.get(key) || { tokens: capacity, updatedAt: now };
    const tokens = Math.min(capacity, current.tokens + Math.max(0, now - current.updatedAt) * refillPerMs);
    if (tokens < 1) {
      const retryMs = Math.ceil((1 - tokens) / refillPerMs);
      this.buckets.set(key, { tokens, updatedAt: now });
      return { allowed: false, remaining: 0, retryMs };
    }
    const remaining = tokens - 1;
    this.buckets.set(key, { tokens: remaining, updatedAt: now });
    return { allowed: true, remaining: Math.floor(remaining), retryMs: 0 };
  }
}

export const rateLimitStore = new MemoryRateLimitStore();

function envLimit(name, fallback) {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const limits = {
  unauthenticated: () => envLimit('OPEN_API_UNAUTHENTICATED_RATE_LIMIT_PER_MINUTE', 30),
  total: () => envLimit('OPEN_API_RATE_LIMIT_PER_MINUTE', 120),
  write: () => envLimit('OPEN_API_WRITE_RATE_LIMIT_PER_MINUTE', 30),
  documentWrite: () => envLimit('OPEN_API_DOCUMENT_WRITE_RATE_LIMIT_PER_MINUTE', 10),
};

export function consumeLimit(req, res, key, capacity) {
  const result = rateLimitStore.take(key, capacity, capacity / 60_000);
  const reset = Math.ceil((Date.now() + (result.retryMs || 60_000 / capacity)) / 1000);
  res.set('X-RateLimit-Limit', String(capacity));
  res.set('X-RateLimit-Remaining', String(result.remaining));
  res.set('X-RateLimit-Reset', String(reset));
  if (!result.allowed) {
    const retryAfter = Math.max(1, Math.ceil(result.retryMs / 1000));
    res.set('Retry-After', String(retryAfter));
    throw new ApiError(429, 'rate_limit_exceeded', '请求过于频繁', { retry_after: retryAfter });
  }
}

export function authenticatedRateLimits(req, res, next) {
  try {
    consumeLimit(req, res, `token:${req.apiToken.id}:all`, limits.total());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      consumeLimit(req, res, `token:${req.apiToken.id}:write`, limits.write());
      const match = req.path.match(/^\/documents\/([^/]+)\/(?:content|blocks|batch)/);
      if (match) consumeLimit(req, res, `token:${req.apiToken.id}:doc:${match[1]}`, limits.documentWrite());
    }
    next();
  } catch (error) { next(error); }
}
