// Serves website/index.html and a small email+password auth API on the same
// origin (so the session cookie needs no CORS). Zero npm dependencies: node:http,
// node:sqlite and node:crypto only. Local-only by default (binds 127.0.0.1).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const scryptAsync = promisify(scrypt);
const here = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '127.0.0.1';
const DB_PATH = process.env.AUTH_DB_PATH ?? join(here, 'data', 'auth.sqlite3');
const SECURE_COOKIE = process.env.SECURE_COOKIES === '1';
const PAGE_PATH = join(here, '..', 'index.html');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 10 * 1024;
const COOKIE = 'kvl_session';

// ---------- database ----------
mkdirSync(dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    email      TEXT NOT NULL UNIQUE,
    name       TEXT NOT NULL,
    pw_salt    TEXT NOT NULL,
    pw_hash    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
`);
const q = {
  userByEmail: db.prepare('SELECT id, email, name, pw_salt, pw_hash FROM users WHERE email = ?'),
  insertUser: db.prepare('INSERT INTO users (email, name, pw_salt, pw_hash, created_at) VALUES (?, ?, ?, ?, ?)'),
  insertSession: db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)'),
  sessionUser: db.prepare(
    'SELECT u.id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?',
  ),
  deleteSession: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
};
q.purgeSessions.run(Date.now());
setInterval(() => q.purgeSessions.run(Date.now()), 60 * 60 * 1000).unref();

// ---------- passwords ----------
async function hashPassword(password, salt) {
  return (await scryptAsync(password, Buffer.from(salt, 'hex'), 64)).toString('hex');
}
// Verified against when the email is unknown, so "no such user" and "wrong
// password" cost the same and can't be told apart by timing.
const DUMMY_SALT = randomBytes(16).toString('hex');
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('hex'), DUMMY_SALT);

async function verifyPassword(password, salt, expectedHex) {
  const got = Buffer.from(await hashPassword(password, salt), 'hex');
  const want = Buffer.from(expectedHex, 'hex');
  return got.length === want.length && timingSafeEqual(got, want);
}

// ---------- sessions ----------
const sha256 = (s) => createHash('sha256').update(s).digest('hex');

function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  q.insertSession.run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

function readCookie(req, name) {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}

function sessionCookie(token, maxAgeSec) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${SECURE_COOKIE ? '; Secure' : ''}`;
}

function currentUser(req) {
  const token = readCookie(req, COOKIE);
  return token ? (q.sessionUser.get(sha256(token), Date.now()) ?? null) : null;
}

// ---------- rate limiting (in memory) ----------
const buckets = new Map();
function allow(key, max, windowMs) {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  b.count += 1;
  return b.count <= max;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 10 * 60 * 1000).unref();

// ---------- http helpers ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Cache-Control': 'no-store',
};
const CSP = [
  "default-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  'font-src https://fonts.gstatic.com',
  "script-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': 'application/json; charset=utf-8', ...extraHeaders });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) throw httpError(415, 'JSON bhejo.');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'Request bahut badi hai.');
    chunks.push(chunk);
  }
  try {
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error('shape');
    return data;
  } catch {
    throw httpError(400, 'Request sahi format me nahi hai.');
  }
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const clientIp = (req) => req.socket.remoteAddress ?? 'unknown';

// ---------- validation ----------
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@.]+(\.[^\s@.]+)+$/;
function cleanEmail(v) {
  const email = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}
function cleanName(v) {
  // eslint-disable-next-line no-control-regex
  const name = typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  return name.length >= 1 && name.length <= 60 ? name : null;
}
const passwordOk = (v) => typeof v === 'string' && v.length >= 8 && v.length <= 128;

// ---------- routes ----------
async function signup(req, res) {
  if (!allow(`signup|${clientIp(req)}`, 5, 60 * 60 * 1000)) throw httpError(429, 'Bahut zyada koshish. Thodi der baad try karo.');
  const body = await readJson(req);
  const email = cleanEmail(body.email);
  const name = cleanName(body.name);
  if (!name) throw httpError(400, 'Naam daalo (1 se 60 akshar).');
  if (!email) throw httpError(400, 'Sahi email daalo.');
  if (!passwordOk(body.password)) throw httpError(400, 'Password 8 se 128 akshar ka hona chahiye.');

  const salt = randomBytes(16).toString('hex');
  const hash = await hashPassword(body.password, salt);
  let userId;
  try {
    userId = Number(q.insertUser.run(email, name, salt, hash, Date.now()).lastInsertRowid);
  } catch (err) {
    if (String(err?.message).includes('UNIQUE')) throw httpError(409, 'Ye email pehle se registered hai. Login karo.');
    throw err;
  }
  const token = createSession(userId);
  sendJson(res, 201, { user: { name, email } }, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000) });
}

async function login(req, res) {
  const ip = clientIp(req);
  if (!allow(`login-ip|${ip}`, 20, 15 * 60 * 1000)) throw httpError(429, 'Bahut zyada koshish. Thodi der baad try karo.');
  const body = await readJson(req);
  const email = cleanEmail(body.email);
  const password = typeof body.password === 'string' ? body.password.slice(0, 128) : '';
  if (email && !allow(`login-email|${email}`, 8, 15 * 60 * 1000)) throw httpError(429, 'Is account par bahut koshish hui. Thodi der baad try karo.');

  const user = email ? q.userByEmail.get(email) : undefined;
  const ok = await verifyPassword(password, user?.pw_salt ?? DUMMY_SALT, user?.pw_hash ?? DUMMY_HASH);
  if (!user || !ok) throw httpError(401, 'Email ya password galat hai.');

  const token = createSession(user.id);
  sendJson(res, 200, { user: { name: user.name, email: user.email } }, { 'Set-Cookie': sessionCookie(token, SESSION_TTL_MS / 1000) });
}

function logout(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) q.deleteSession.run(sha256(token));
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', 0) });
}

function me(req, res) {
  const user = currentUser(req);
  sendJson(res, 200, { user: user ? { name: user.name, email: user.email } : null });
}

async function servePage(res) {
  const html = await readFile(PAGE_PATH);
  res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': CSP });
  res.end(html);
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(process.env.ALLOWED_HOSTS ?? '').split(',').filter(Boolean)]);

const server = http.createServer(async (req, res) => {
  try {
    // Reject unexpected Host headers (DNS-rebinding defence for a localhost service).
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) throw httpError(400, 'Bad host.');
    const { pathname } = new URL(req.url ?? '/', 'http://local');

    if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) return await servePage(res);
    if (req.method === 'GET' && pathname === '/api/me') return me(req, res);

    if (req.method === 'POST' && pathname.startsWith('/api/')) {
      // CSRF: browsers always send Origin on cross-site POSTs; it must be us.
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}` && origin !== `https://${req.headers.host}`) throw httpError(403, 'Origin allowed nahi hai.');
      if (pathname === '/api/signup') return await signup(req, res);
      if (pathname === '/api/login') return await login(req, res);
      if (pathname === '/api/logout') return logout(req, res);
    }
    throw httpError(404, 'Nahi mila.');
  } catch (err) {
    const status = err?.status ?? 500;
    if (status === 500) console.error('[auth] unexpected error:', err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'Server error.' : err.message });
  }
});

server.listen(PORT, HOST, () => console.log(`[website] http://${HOST}:${PORT}  (db: ${DB_PATH})`));
