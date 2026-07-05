import { createHash, randomBytes, randomUUID } from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from './database.js';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'doco_session';

const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(googleClientId || undefined);
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS || 30);
const sessionTtlMs = sessionTtlDays * 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function parseCookies(cookieHeader = '') {
  const cookies = {};
  for (const part of cookieHeader.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) cookies[name] = decodeURIComponent(value);
  }
  return cookies;
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatar_url,
  };
}

function cookieOptions(req, expiresAt) {
  const secure =
    process.env.COOKIE_SECURE === 'true' ||
    process.env.NODE_ENV === 'production' ||
    req?.get?.('x-forwarded-proto') === 'https';
  const sameSite = process.env.COOKIE_SAMESITE || (secure ? 'none' : 'lax');
  return {
    httpOnly: true,
    secure,
    sameSite,
    path: '/',
    expires: expiresAt ? new Date(expiresAt) : undefined,
  };
}

function ensureDefaultWorkspace(user) {
  const existing = db.prepare(`
    SELECT w.*
    FROM workspaces w
    JOIN workspace_members wm ON wm.workspace_id = w.id
    WHERE wm.user_id = ?
    ORDER BY w.created_at ASC
    LIMIT 1
  `).get(user.id);

  if (existing) return existing;

  const timestamp = now();
  const workspace = {
    id: randomUUID(),
    name: user.name ? `${user.name} 的空间` : '个人空间',
    owner_user_id: user.id,
    created_at: timestamp,
    updated_at: timestamp,
  };

  db.prepare(`
    INSERT INTO workspaces (id, name, owner_user_id, created_at, updated_at)
    VALUES (@id, @name, @owner_user_id, @created_at, @updated_at)
  `).run(workspace);

  db.prepare(`
    INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
    VALUES (?, ?, 'owner', ?)
  `).run(workspace.id, user.id, timestamp);

  return workspace;
}

function claimLegacyKnowledgeBases(workspaceId) {
  db.prepare('UPDATE knowledge_bases SET workspace_id = ? WHERE workspace_id IS NULL').run(workspaceId);
}

const upsertGoogleUserTx = db.transaction((payload) => {
  const timestamp = now();
  const userCountBefore = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  const existing = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(payload.sub);

  let user;
  if (existing) {
    db.prepare(`
      UPDATE users
      SET email = ?, name = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(payload.email, payload.name || null, payload.picture || null, timestamp, existing.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(existing.id);
  } else {
    user = {
      id: randomUUID(),
      google_sub: payload.sub,
      email: payload.email,
      name: payload.name || null,
      avatar_url: payload.picture || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(`
      INSERT INTO users (id, google_sub, email, name, avatar_url, created_at, updated_at)
      VALUES (@id, @google_sub, @email, @name, @avatar_url, @created_at, @updated_at)
    `).run(user);
  }

  const workspace = ensureDefaultWorkspace(user);
  if (userCountBefore === 0) claimLegacyKnowledgeBases(workspace.id);

  return { user: publicUser(user), workspace };
});

export async function verifyGoogleCredential(credential) {
  if (!googleClientId) {
    const error = new Error('GOOGLE_CLIENT_ID 未配置');
    error.statusCode = 500;
    throw error;
  }

  const ticket = await googleClient.verifyIdToken({
    idToken: credential,
    audience: googleClientId,
  });
  const payload = ticket.getPayload();

  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    const error = new Error('Google 账号邮箱未验证');
    error.statusCode = 401;
    throw error;
  }

  return payload;
}

export function upsertGoogleUser(payload) {
  return upsertGoogleUserTx(payload);
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const timestamp = now();
  const expiresAt = timestamp + sessionTtlMs;

  db.prepare(`
    INSERT INTO sessions (id, user_id, expires_at, created_at, last_seen_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(hashSessionToken(token), userId, expiresAt, timestamp, timestamp);

  return { token, expiresAt };
}

export function setSessionCookie(res, token, expiresAt, req) {
  res.cookie(SESSION_COOKIE_NAME, token, cookieOptions(req, expiresAt));
}

export function clearSessionCookie(res, req) {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions(req));
}

export function deleteSessionFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return;
  db.prepare('DELETE FROM sessions WHERE id = ?').run(hashSessionToken(token));
}

export function getSessionUserFromCookieHeader(cookieHeader) {
  const token = parseCookies(cookieHeader)[SESSION_COOKIE_NAME];
  if (!token) return null;

  const sessionId = hashSessionToken(token);
  const row = db.prepare(`
    SELECT
      s.id AS session_id,
      s.expires_at,
      u.id,
      u.email,
      u.name,
      u.avatar_url
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = ?
  `).get(sessionId);

  if (!row) return null;
  if (row.expires_at <= now()) {
    db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    return null;
  }

  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now(), sessionId);
  return publicUser(row);
}

export function getSessionUserFromRequest(req) {
  return getSessionUserFromCookieHeader(req.headers.cookie || '');
}

export function requireAuth(req, res, next) {
  const user = getSessionUserFromRequest(req);
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  req.user = user;
  next();
}
