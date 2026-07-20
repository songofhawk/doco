import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db } from './database.js';
import { sendLoginCodeEmail } from './email.js';

export const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || 'doco_session';

const googleClientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
const googleClient = new OAuth2Client(googleClientId || undefined);
const sessionTtlDays = Number(process.env.SESSION_TTL_DAYS || 30);
const sessionTtlMs = sessionTtlDays * 24 * 60 * 60 * 1000;
const emailCodeTtlMs = Number(process.env.EMAIL_CODE_TTL_MINUTES || 10) * 60 * 1000;
const emailCodeResendMs = Number(process.env.EMAIL_CODE_RESEND_SECONDS || 60) * 1000;
const emailCodeMaxPerHour = Number(process.env.EMAIL_CODE_MAX_PER_HOUR || 5);
const emailCodeIpMaxPerHour = Number(process.env.EMAIL_CODE_IP_MAX_PER_HOUR || 20);
const emailCodeMaxAttempts = Number(process.env.EMAIL_CODE_MAX_ATTEMPTS || 5);

function now() {
  return Date.now();
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

export function normalizeEmail(value) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    const error = new Error('请输入有效的邮箱地址');
    error.statusCode = 400;
    throw error;
  }
  return email;
}

function authError(message, statusCode = 401, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function hashRequesterIp(ip = '') {
  return createHash('sha256').update(String(ip)).digest('hex');
}

function hashEmailCode(code, salt) {
  return scryptSync(code, salt, 32).toString('hex');
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
    appearanceTheme: row.appearance_theme === 'paper' ? 'paper' : 'simple',
  };
}

function cookieOptions(req, expiresAt) {
  const secure = process.env.COOKIE_SECURE === undefined
    ? process.env.NODE_ENV === 'production' || req?.get?.('x-forwarded-proto') === 'https'
    : process.env.COOKIE_SECURE === 'true';
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
  const normalizedEmail = normalizeEmail(payload.email);
  const identityUser = db.prepare(`
    SELECT u.*
    FROM auth_identities ai
    JOIN users u ON u.id = ai.user_id
    WHERE ai.provider = 'google' AND ai.subject = ?
  `).get(payload.sub);
  const emailUser = db.prepare('SELECT * FROM users WHERE normalized_email = ?').get(normalizedEmail);

  let user;
  if (identityUser) {
    if (emailUser && emailUser.id !== identityUser.id) {
      throw authError('该 Google 账号与现有邮箱账户存在冲突，请联系管理员处理', 409, 'ACCOUNT_LINK_CONFLICT');
    }
    db.prepare(`
      UPDATE users
      SET email = ?, normalized_email = ?, email_verified_at = ?, name = ?, avatar_url = ?, updated_at = ?
      WHERE id = ?
    `).run(
      payload.email,
      normalizedEmail,
      timestamp,
      payload.name || identityUser.name || null,
      payload.picture || identityUser.avatar_url || null,
      timestamp,
      identityUser.id,
    );
    db.prepare(`
      UPDATE auth_identities SET email = ?, updated_at = ?
      WHERE provider = 'google' AND subject = ?
    `).run(payload.email, timestamp, payload.sub);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(identityUser.id);
  } else if (emailUser) {
    if (!emailUser.email_verified_at) {
      throw authError('该邮箱账户尚未验证，不能自动关联 Google', 409, 'EMAIL_NOT_VERIFIED');
    }
    db.prepare(`
      INSERT INTO auth_identities (provider, subject, user_id, email, created_at, updated_at)
      VALUES ('google', ?, ?, ?, ?, ?)
    `).run(payload.sub, emailUser.id, payload.email, timestamp, timestamp);
    db.prepare(`
      UPDATE users
      SET email = ?, name = COALESCE(name, ?), avatar_url = COALESCE(avatar_url, ?), updated_at = ?
      WHERE id = ?
    `).run(payload.email, payload.name || null, payload.picture || null, timestamp, emailUser.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(emailUser.id);
  } else {
    user = {
      id: randomUUID(),
      email: payload.email,
      normalized_email: normalizedEmail,
      email_verified_at: timestamp,
      name: payload.name || null,
      avatar_url: payload.picture || null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(`
      INSERT INTO users (
        id, email, normalized_email, email_verified_at, name, avatar_url, created_at, updated_at
      ) VALUES (
        @id, @email, @normalized_email, @email_verified_at, @name, @avatar_url, @created_at, @updated_at
      )
    `).run(user);
    db.prepare(`
      INSERT INTO auth_identities (provider, subject, user_id, email, created_at, updated_at)
      VALUES ('google', ?, ?, ?, ?, ?)
    `).run(payload.sub, user.id, payload.email, timestamp, timestamp);
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

export async function requestEmailLoginCode(emailValue, requesterIp, deliver = sendLoginCodeEmail) {
  const normalizedEmail = normalizeEmail(emailValue);
  const timestamp = now();
  const hourAgo = timestamp - 60 * 60 * 1000;
  const requesterIpHash = hashRequesterIp(requesterIp);
  const latest = db.prepare(`
    SELECT created_at FROM email_login_codes
    WHERE normalized_email = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(normalizedEmail);

  if (latest && latest.created_at + emailCodeResendMs > timestamp) {
    const retryAfter = Math.ceil((latest.created_at + emailCodeResendMs - timestamp) / 1000);
    const error = authError(`请在 ${retryAfter} 秒后重新发送`, 429, 'EMAIL_CODE_TOO_FREQUENT');
    error.retryAfter = retryAfter;
    throw error;
  }

  const emailRequests = db.prepare(`
    SELECT COUNT(*) AS count FROM email_login_codes
    WHERE normalized_email = ? AND created_at > ?
  `).get(normalizedEmail, hourAgo).count;
  const ipRequests = db.prepare(`
    SELECT COUNT(*) AS count FROM email_login_codes
    WHERE requester_ip_hash = ? AND created_at > ?
  `).get(requesterIpHash, hourAgo).count;
  if (emailRequests >= emailCodeMaxPerHour || ipRequests >= emailCodeIpMaxPerHour) {
    throw authError('验证码发送次数过多，请稍后再试', 429, 'EMAIL_CODE_RATE_LIMITED');
  }

  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const salt = randomBytes(16).toString('hex');
  const id = randomUUID();
  db.prepare(`
    INSERT INTO email_login_codes (
      id, normalized_email, code_hash, code_salt, requester_ip_hash, expires_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    normalizedEmail,
    hashEmailCode(code, salt),
    salt,
    requesterIpHash,
    timestamp + emailCodeTtlMs,
    timestamp,
  );

  try {
    await deliver({ to: normalizedEmail, code });
  } catch {
    db.prepare('DELETE FROM email_login_codes WHERE id = ?').run(id);
    throw authError('验证码暂时无法发送，请稍后再试', 503, 'EMAIL_DELIVERY_FAILED');
  }

  db.prepare(`
    DELETE FROM email_login_codes
    WHERE created_at < ? OR (consumed_at IS NOT NULL AND consumed_at < ?)
  `).run(timestamp - 24 * 60 * 60 * 1000, timestamp - 60 * 60 * 1000);

  return {
    email: normalizedEmail,
    expiresInSeconds: Math.round(emailCodeTtlMs / 1000),
    retryAfterSeconds: Math.round(emailCodeResendMs / 1000),
  };
}

const verifyEmailLoginCodeTx = db.transaction((emailValue, codeValue) => {
  const normalizedEmail = normalizeEmail(emailValue);
  const code = typeof codeValue === 'string' ? codeValue.trim() : '';
  if (!/^\d{6}$/.test(code)) throw authError('验证码不正确或已过期');

  const timestamp = now();
  const record = db.prepare(`
    SELECT * FROM email_login_codes
    WHERE normalized_email = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(normalizedEmail);

  if (!record || record.expires_at <= timestamp) {
    throw authError('验证码不正确或已过期');
  }
  if (record.attempts >= emailCodeMaxAttempts) {
    throw authError('验证码尝试次数过多，请重新获取', 429, 'EMAIL_CODE_ATTEMPTS_EXCEEDED');
  }

  const expected = Buffer.from(record.code_hash, 'hex');
  const actual = Buffer.from(hashEmailCode(code, record.code_salt), 'hex');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    db.prepare('UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = ?').run(record.id);
    return { authFailure: { message: '验证码不正确或已过期', statusCode: 401 } };
  }

  const consumed = db.prepare(`
    UPDATE email_login_codes SET consumed_at = ?
    WHERE id = ? AND consumed_at IS NULL
  `).run(timestamp, record.id);
  if (consumed.changes !== 1) throw authError('验证码已使用，请重新获取');
  const userCountBefore = db.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  let user = db.prepare('SELECT * FROM users WHERE normalized_email = ?').get(normalizedEmail);
  if (!user) {
    user = {
      id: randomUUID(),
      email: normalizedEmail,
      normalized_email: normalizedEmail,
      email_verified_at: timestamp,
      name: null,
      avatar_url: null,
      created_at: timestamp,
      updated_at: timestamp,
    };
    db.prepare(`
      INSERT INTO users (
        id, email, normalized_email, email_verified_at, name, avatar_url, created_at, updated_at
      ) VALUES (
        @id, @email, @normalized_email, @email_verified_at, @name, @avatar_url, @created_at, @updated_at
      )
    `).run(user);
  } else {
    db.prepare(`
      UPDATE users SET email_verified_at = COALESCE(email_verified_at, ?), updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, user.id);
    user = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  }

  const workspace = ensureDefaultWorkspace(user);
  if (userCountBefore === 0) claimLegacyKnowledgeBases(workspace.id);
  return { user: publicUser(user), workspace };
});

export function verifyEmailLoginCode(email, code) {
  const result = verifyEmailLoginCodeTx(email, code);
  if (result.authFailure) {
    throw authError(result.authFailure.message, result.authFailure.statusCode, result.authFailure.code);
  }
  return result;
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
      u.avatar_url,
      u.appearance_theme
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

export function updateUserAppearance(userId, appearanceTheme) {
  if (!['simple', 'paper'].includes(appearanceTheme)) {
    throw authError('不支持的外观样式', 400, 'INVALID_APPEARANCE_THEME');
  }
  const timestamp = now();
  const result = db.prepare(`
    UPDATE users SET appearance_theme = ?, updated_at = ? WHERE id = ?
  `).run(appearanceTheme, timestamp, userId);
  if (result.changes !== 1) {
    throw authError('用户不存在', 404, 'USER_NOT_FOUND');
  }
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId));
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
