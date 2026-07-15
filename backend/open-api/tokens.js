import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { ulid } from 'ulid';
import { db } from '../database.js';
import { ApiError } from './errors.js';
import { audit } from './audit.js';

export const ALL_SCOPES = [
  'documents:read', 'documents:write',
  'knowledge-bases:read', 'knowledge-bases:write',
  'attachments:read', 'attachments:write',
];
export const READ_ONLY_SCOPES = ['documents:read', 'knowledge-bases:read', 'attachments:read'];

export function hashTokenSecret(secret) {
  return createHash('sha256').update(secret).digest('hex');
}

function normalizeScopes(input) {
  const requested = input === 'read_only' ? READ_ONLY_SCOPES : input === 'read_write' ? ALL_SCOPES : input;
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new ApiError(400, 'invalid_scopes', 'scopes 必须是 read_only、read_write 或非空权限数组');
  }
  const scopes = [...new Set(requested.map(String))];
  if (scopes.some((scope) => !ALL_SCOPES.includes(scope))) {
    throw new ApiError(400, 'invalid_scopes', '包含不支持的 scope');
  }
  return scopes;
}

export function createApiToken(userId, body, req) {
  const name = String(body?.name || '').trim();
  if (!name || name.length > 100) throw new ApiError(400, 'invalid_token_name', 'Token 名称长度必须为 1 到 100 个字符');
  const scopes = normalizeScopes(body?.scopes || body?.access || 'read_only');
  const expiresAt = body?.expires_at == null ? null : Number(body.expires_at);
  if (expiresAt !== null && (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now())) {
    throw new ApiError(400, 'invalid_expiry', 'expires_at 必须是未来的毫秒时间戳');
  }
  const id = `tok_${ulid()}`;
  const secret = randomBytes(32).toString('base64url');
  const createdAt = Date.now();
  db.prepare(`
    INSERT INTO api_tokens (id, user_id, name, secret_hash, scopes, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, userId, name, hashTokenSecret(secret), JSON.stringify(scopes), expiresAt, createdAt);
  audit('api_token.created', req, { userId, tokenId: id, resourceType: 'api_token', resourceId: id, metadata: { scopes } });
  return { id, name, token: `doco_${id}_${secret}`, scopes, expires_at: expiresAt, created_at: createdAt };
}

function publicToken(row) {
  return {
    id: row.id,
    name: row.name,
    scopes: JSON.parse(row.scopes),
    expires_at: row.expires_at,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    revoked_at: row.revoked_at,
  };
}

export function listApiTokens(userId) {
  return db.prepare('SELECT * FROM api_tokens WHERE user_id = ? ORDER BY created_at DESC').all(userId).map(publicToken);
}

export function revokeApiToken(userId, id, req) {
  const info = db.prepare('UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
    .run(Date.now(), id, userId);
  if (!info.changes) throw new ApiError(404, 'token_not_found', 'Token 不存在');
  audit('api_token.revoked', req, { userId, tokenId: id, resourceType: 'api_token', resourceId: id });
}

export function authenticateBearer(value) {
  const match = /^Bearer\s+(doco_(tok_[0-9A-HJKMNP-TV-Z]{26})_([A-Za-z0-9_-]{43}))$/i.exec(value || '');
  if (!match) return null;
  const row = db.prepare(`
    SELECT t.*, u.email, u.name AS user_name, u.avatar_url
    FROM api_tokens t JOIN users u ON u.id = t.user_id WHERE t.id = ?
  `).get(match[2]);
  if (!row || row.revoked_at || (row.expires_at && row.expires_at <= Date.now())) return null;
  const actual = Buffer.from(hashTokenSecret(match[3]), 'hex');
  const expected = Buffer.from(row.secret_hash, 'hex');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  db.prepare('UPDATE api_tokens SET last_used_at = ? WHERE id = ?').run(Date.now(), row.id);
  return { ...row, scopes: JSON.parse(row.scopes) };
}

export function requireScopes(...required) {
  return (req, _res, next) => {
    if (!required.every((scope) => req.apiToken.scopes.includes(scope))) {
      return next(new ApiError(403, 'insufficient_scope', 'Token scope 不足', { required_scopes: required }));
    }
    next();
  };
}
