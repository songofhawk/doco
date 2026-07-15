import { createHash } from 'crypto';
import { db } from '../database.js';
import { ApiError } from './errors.js';

const TTL = 24 * 60 * 60 * 1000;

function requestHash(req) {
  const hash = createHash('sha256').update(JSON.stringify(req.body ?? null));
  if (req.file?.buffer) hash.update(req.file.buffer);
  return hash.digest('hex');
}

export function idempotent(handler) {
  return async (req, res, next) => {
    const key = String(req.get('idempotency-key') || '').trim();
    if (!key) return Promise.resolve(handler(req, res, next)).catch(next);
    if (!/^[\x21-\x7E]{1,128}$/.test(key)) return next(new ApiError(400, 'invalid_idempotency_key', 'Idempotency-Key 非法'));
    const now = Date.now();
    db.prepare('DELETE FROM idempotency_keys WHERE created_at < ?').run(now - TTL);
    const hash = requestHash(req);
    const existing = db.prepare(`
      SELECT * FROM idempotency_keys WHERE token_id = ? AND method = ? AND path = ? AND idempotency_key = ?
    `).get(req.apiToken.id, req.method, req.path, key);
    if (existing) {
      if (existing.request_hash !== hash) return next(new ApiError(409, 'idempotency_key_conflict', '幂等键已用于不同请求体'));
      res.status(existing.status_code).json(JSON.parse(existing.response_body));
      return;
    }

    const originalJson = res.json.bind(res);
    res.json = (body) => {
      if (res.statusCode < 400) {
        db.prepare(`
          INSERT INTO idempotency_keys
            (token_id, method, path, idempotency_key, request_hash, status_code, response_body, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(req.apiToken.id, req.method, req.path, key, hash, res.statusCode, JSON.stringify(body), now);
      }
      return originalJson(body);
    };
    return Promise.resolve(handler(req, res, next)).catch(next);
  };
}
