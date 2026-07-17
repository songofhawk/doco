import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const tempDir = mkdtempSync(join(tmpdir(), 'doco-auth-test-'));
process.env.DOCO_DB_PATH = join(tempDir, 'test.db');
process.env.EMAIL_CODE_RESEND_SECONDS = '60';
process.env.EMAIL_CODE_MAX_PER_HOUR = '5';
process.env.EMAIL_CODE_IP_MAX_PER_HOUR = '20';

let db;
let requestEmailLoginCode;
let verifyEmailLoginCode;
let upsertGoogleUser;
let updateUserAppearance;

before(async () => {
  ({ db } = await import('../database.js'));
  ({
    requestEmailLoginCode,
    verifyEmailLoginCode,
    upsertGoogleUser,
    updateUserAppearance,
  } = await import('../auth.js'));
});

after(() => {
  try { db.close(); } catch {}
  rmSync(tempDir, { recursive: true, force: true });
});

test('v3 迁移保留原 Google 用户、工作区和会话外键', async () => {
  const { migrations, runMigrations } = await import('../migrations.js');
  const path = join(tempDir, 'legacy.db');
  const legacy = new Database(path);
  legacy.pragma('foreign_keys = ON');
  legacy.exec(`
    CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL);
    ${migrations[0].up}
    ${migrations[1].up}
  `);
  legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(1, migrations[0].name, Date.now());
  legacy.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(2, migrations[1].name, Date.now());
  const timestamp = Date.now();
  legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('legacy-user', 'legacy-google', 'Legacy@Example.com', 'Legacy', null, timestamp, timestamp);
  legacy.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)')
    .run('legacy-workspace', 'Legacy', 'legacy-user', timestamp, timestamp);
  legacy.prepare('INSERT INTO workspace_members VALUES (?, ?, ?, ?)')
    .run('legacy-workspace', 'legacy-user', 'owner', timestamp);

  runMigrations(legacy);

  assert.equal(legacy.prepare('SELECT normalized_email FROM users WHERE id = ?').get('legacy-user').normalized_email, 'legacy@example.com');
  assert.equal(legacy.prepare('SELECT user_id FROM auth_identities WHERE provider = ? AND subject = ?').get('google', 'legacy-google').user_id, 'legacy-user');
  assert.equal(legacy.prepare('SELECT owner_user_id FROM workspaces WHERE id = ?').get('legacy-workspace').owner_user_id, 'legacy-user');
  assert.deepEqual(legacy.pragma('foreign_key_check'), []);
  legacy.close();
});

test('邮箱验证码创建账户，验证码只保存哈希且只能使用一次', async () => {
  let delivered;
  const issued = await requestEmailLoginCode(' New.User@Example.com ', '127.0.0.1', async (message) => {
    delivered = message;
  });
  assert.equal(issued.email, 'new.user@example.com');
  assert.match(delivered.code, /^\d{6}$/);

  const stored = db.prepare('SELECT * FROM email_login_codes WHERE normalized_email = ?').get(issued.email);
  assert.equal(JSON.stringify(stored).includes(delivered.code), false);

  const result = verifyEmailLoginCode(issued.email, delivered.code);
  assert.equal(result.user.email, issued.email);
  assert.ok(db.prepare('SELECT 1 FROM workspace_members WHERE user_id = ?').get(result.user.id));
  assert.throws(() => verifyEmailLoginCode(issued.email, delivered.code), /验证码/);
});

test('用户外观偏好默认简洁并可切换为纸感', async () => {
  const user = db.prepare('SELECT * FROM users WHERE normalized_email = ?').get('new.user@example.com');
  assert.equal(user.appearance_theme, 'simple');
  assert.equal(updateUserAppearance(user.id, 'paper').appearanceTheme, 'paper');
  assert.equal(db.prepare('SELECT appearance_theme FROM users WHERE id = ?').get(user.id).appearance_theme, 'paper');
  assert.throws(
    () => updateUserAppearance(user.id, 'unknown'),
    (error) => error.statusCode === 400 && error.code === 'INVALID_APPEARANCE_THEME',
  );
});

test('Google 首次登录自动关联已验证的同邮箱用户', async () => {
  const emailUser = db.prepare('SELECT * FROM users WHERE normalized_email = ?').get('new.user@example.com');
  const result = upsertGoogleUser({
    sub: 'google-new-user',
    email: 'New.User@example.com',
    email_verified: true,
    name: 'New User',
    picture: 'https://example.com/avatar.png',
  });
  assert.equal(result.user.id, emailUser.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM users WHERE normalized_email = ?').get('new.user@example.com').count, 1);
  assert.equal(db.prepare(`
    SELECT user_id FROM auth_identities WHERE provider = 'google' AND subject = ?
  `).get('google-new-user').user_id, emailUser.id);
});

test('Google 注册用户后续使用同邮箱验证码登录仍是同一账户', async () => {
  const googleResult = upsertGoogleUser({
    sub: 'google-code-login',
    email: 'Google.Code@Example.com',
    email_verified: true,
    name: 'Google Code User',
  });

  let delivered;
  await requestEmailLoginCode('google.code@example.com', '127.0.0.5', async (message) => {
    delivered = message;
  });
  const emailResult = verifyEmailLoginCode('GOOGLE.CODE@example.com', delivered.code);

  assert.equal(emailResult.user.id, googleResult.user.id);
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM users WHERE normalized_email = ?')
      .get('google.code@example.com').count,
    1,
  );
});

test('Google 身份与另一现有邮箱账户冲突时禁止静默合并', async () => {
  const first = upsertGoogleUser({
    sub: 'google-conflict',
    email: 'first@example.com',
    email_verified: true,
  });
  let delivered;
  await requestEmailLoginCode('second@example.com', '127.0.0.2', async (message) => { delivered = message; });
  const second = verifyEmailLoginCode('second@example.com', delivered.code);
  assert.notEqual(first.user.id, second.user.id);
  assert.throws(() => upsertGoogleUser({
    sub: 'google-conflict',
    email: 'second@example.com',
    email_verified: true,
  }), (error) => error.statusCode === 409 && error.code === 'ACCOUNT_LINK_CONFLICT');
});

test('同一邮箱一分钟内不能重复发送验证码', async () => {
  let delivered;
  await requestEmailLoginCode('limited@example.com', '127.0.0.3', async (message) => { delivered = message; });
  assert.ok(delivered.code);
  await assert.rejects(
    requestEmailLoginCode('limited@example.com', '127.0.0.3', async () => {}),
    (error) => error.statusCode === 429 && error.code === 'EMAIL_CODE_TOO_FREQUENT',
  );
});

test('错误验证码尝试次数会持久化并最终锁定当前验证码', async () => {
  let delivered;
  await requestEmailLoginCode('attempts@example.com', '127.0.0.4', async (message) => { delivered = message; });
  const wrongCode = String((Number(delivered.code) + 1) % 1_000_000).padStart(6, '0');
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.throws(() => verifyEmailLoginCode('attempts@example.com', wrongCode), /验证码/);
    const row = db.prepare(`
      SELECT attempts FROM email_login_codes WHERE normalized_email = ? ORDER BY created_at DESC LIMIT 1
    `).get('attempts@example.com');
    assert.equal(row.attempts, attempt);
  }
  assert.throws(
    () => verifyEmailLoginCode('attempts@example.com', delivered.code),
    (error) => error.statusCode === 429 && error.code === 'EMAIL_CODE_ATTEMPTS_EXCEEDED',
  );
});
