'use strict';
/* Máy chủ HTTP của hệ thống Báo giá nông sản: API đăng nhập / đồng bộ dữ liệu + phục vụ giao diện web.
   Cơ sở dữ liệu PostgreSQL (thư viện pg). Chạy:  node server/server.js   (cổng 8080, đổi bằng PORT) */
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const db = require('./db');
const { docs, audit } = db;
const auth = require('./auth');
const P = require('./policy');
const S = require('./sync');
const D = require('./domain');
const seed = require('./seed');
const ticker = require('./ticker');

const PORT = +(process.env.PORT || 8080);
const TRUST_PROXY = process.env.BG_TRUST_PROXY === '1' || !!process.env.RENDER;   // chạy sau proxy HTTPS của dịch vụ đám mây (Render…): tin X-Forwarded-*
const HOST = process.env.HOST || (process.env.RENDER ? '0.0.0.0' : '127.0.0.1');          // đặt HOST=0.0.0.0 để cho máy khác trong mạng nội bộ truy cập
const DIST = path.join(__dirname, '..', 'client', 'dist');
const COOKIE = 'bg_sid';
const MAX_BODY = 3 * 1024 * 1024;
const publicBase = process.env.BG_BASE_URL || process.env.RENDER_EXTERNAL_URL || '';      // địa chỉ dùng trong link đặt lại mật khẩu; mặc định theo cổng đang chạy (không tin tiêu đề Host của yêu cầu)

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
const SEC = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: blob:; connect-src 'self'; worker-src blob:; frame-ancestors 'none'",
};

const cookies = (req) => Object.fromEntries(String(req.headers.cookie || '').split(';').map((s) => s.trim().split('=')).filter((a) => a[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const ipOf = (req) => (TRUST_PROXY && String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()) || req.socket.remoteAddress || '';
function send(res, code, body, headers = {}) { res.writeHead(code, { ...SEC, ...headers }); res.end(body); }
function json(res, code, obj, headers = {}) { send(res, code, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('Yêu cầu quá lớn'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(Object.assign(new Error('JSON không hợp lệ'), { code: 400 })); } });
    req.on('error', reject);
  });
}
const setCookie = (sid, maxAge) => `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${TRUST_PROXY ? '; Secure' : ''}`;
const publicUser = (u) => { const c = { ...u }; delete c.pw; return c; };

/** Xác thực phiên + vai trò đang dùng. need: 'session' (chỉ cần đăng nhập) hoặc 'role' (cần chọn vai trò) */
async function guard(req, res, need) {
  const sess = await auth.getSession(cookies(req)[COOKIE]);
  if (!sess) { json(res, 401, { error: 'unauthenticated', msg: 'Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.' }); return null; }
  if (req.method === 'POST' && req.headers['x-requested-with'] !== 'bg') { json(res, 403, { error: 'csrf', msg: 'Yêu cầu không hợp lệ.' }); return null; }
  const ctx = P.makeCtx(sess.user, req.headers['x-role']); ctx.sid = sess.sid;
  if (need === 'role' && !ctx.level) { json(res, 400, { error: 'norole', msg: 'Chưa chọn vai trò làm việc.' }); return null; }
  return ctx;
}

async function api(req, res, url) {
  const ip = ipOf(req); const r = url.pathname;
  if (r === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, time: new Date().toISOString(), clock: await D.clock(), docs: await docs.count(), db: 'postgresql' });
  if (r === '/api/config' && req.method === 'GET') return json(res, 200, { demoHints: process.env.BG_DEMO_HINTS !== '0' });

  if (r === '/api/login' && req.method === 'POST') {
    if (req.headers['x-requested-with'] !== 'bg') return json(res, 403, { error: 'csrf', msg: 'Yêu cầu không hợp lệ.' });
    const b = await readBody(req); const out = await auth.login(b.u, b.pw, ip, req.headers['user-agent']);
    if (!out.ok) return json(res, out.code || 401, { error: 'login', msg: out.msg, left: out.left, until: out.until });
    return json(res, 200, { ok: true, user: publicUser(out.user) }, { 'Set-Cookie': setCookie(out.sid, 604800) });
  }
  if (r === '/api/logout' && req.method === 'POST') { await auth.logout(cookies(req)[COOKIE]); return json(res, 200, { ok: true }, { 'Set-Cookie': setCookie('', 0) }); }
  if (r === '/api/forgot' && req.method === 'POST') {
    const b = await readBody(req); const out = await auth.requestReset(b.email, publicBase || `http://localhost:${server.address().port}`, ip);
    return json(res, out.ok ? 200 : (out.code || 400), out.ok ? { ok: true } : { error: 'rate', msg: out.msg });
  }
  if (r === '/api/reset' && req.method === 'POST') {
    const b = await readBody(req); const out = await auth.applyReset(b.token, b.pw); return json(res, out.ok ? 200 : 400, out.ok ? { ok: true } : { error: 'reset', msg: out.msg });
  }

  if (r === '/api/me' && req.method === 'GET') {
    const ctx = await guard(req, res, 'session'); if (!ctx) return;
    return json(res, 200, { user: publicUser(ctx.user), depts: (await docs.all('depts')).map((x) => x.doc), bgXa: (await docs.all('bgXa')).map((x) => ({ id: x.doc.id, ten: x.doc.ten, vung: x.doc.vung })), clock: await D.clock() });
  }
  if (r === '/api/password' && req.method === 'POST') {
    const ctx = await guard(req, res, 'session'); if (!ctx) return; const b = await readBody(req);
    const out = await auth.changePassword(ctx.user, b.old, b.pw); if (out.ok) await audit(ctx, 'users', ctx.user.id, 'password', 'Đổi mật khẩu', ip);
    return json(res, out.ok ? 200 : 400, out.ok ? { ok: true } : { error: 'password', msg: out.msg });
  }
  if (r === '/api/state' && req.method === 'GET') { const ctx = await guard(req, res, 'role'); if (!ctx) return; return json(res, 200, await S.buildState(ctx)); }
  if (r === '/api/changes' && req.method === 'GET') { const ctx = await guard(req, res, 'role'); if (!ctx) return; return json(res, 200, await S.changesSince(ctx, +url.searchParams.get('since') || 0)); }
  if (r === '/api/sync' && req.method === 'POST') {
    const ctx = await guard(req, res, 'role'); if (!ctx) return; const b = await readBody(req);
    if (!Array.isArray(b.ops) || b.ops.length > 2000) return json(res, 400, { error: 'invalid', msg: 'Danh sách thay đổi không hợp lệ.' });
    const results = await S.applyOps(ctx, b.ops, ip); return json(res, 200, { results, cursor: await docs.cursor(), clock: await D.clock() });
  }
  if (r === '/api/audit' && req.method === 'GET') {
    const ctx = await guard(req, res, 'role'); if (!ctx) return; if (!ctx.isAdmin) return json(res, 403, { error: 'forbidden', msg: 'Chỉ Admin xem nhật ký hệ thống.' });
    const n = Math.min(500, +url.searchParams.get('limit') || 100);
    const q = await db.query('SELECT seq::bigint AS seq, at, who, level, c, id, op, summary FROM audit ORDER BY seq DESC LIMIT $1', [n]);
    return json(res, 200, { rows: q.rows.map((x) => ({ ...x, seq: Number(x.seq), at: new Date(x.at).toISOString() })) });
  }
  return json(res, 404, { error: 'notfound', msg: 'Không tìm thấy.' });
}

const cache = new Map();
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname); if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(DIST, rel));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { return send(res, 404, 'Không tìm thấy', { 'Content-Type': 'text/plain; charset=utf-8' }); }
  const st = fs.statSync(file); const key = file + ':' + st.mtimeMs; let ent = cache.get(key);
  if (!ent) { const raw = fs.readFileSync(file); ent = { raw, gz: raw.length > 2048 ? zlib.gzipSync(raw, { level: 6 }) : null, etag: `"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"` }; cache.set(key, ent); }
  const headers = { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: ent.etag };
  if (req.headers['if-none-match'] === ent.etag) return send(res, 304, '', headers);
  if (ent.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) return send(res, 200, ent.gz, { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' });
  return send(res, 200, ent.raw, headers);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) return await api(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, url);
  } catch (e) {
    if (e && e.code === 413) return json(res, 413, { error: 'toolarge', msg: 'Dữ liệu gửi lên quá lớn.' });
    if (e && e.code === 400) return json(res, 400, { error: 'invalid', msg: e.message });
    console.error('Lỗi xử lý yêu cầu', req.method, req.url, e); try { json(res, 500, { error: 'server', msg: 'Lỗi máy chủ.' }); } catch (e2) { /* đã gửi */ }
  }
});

async function start(port = PORT, host = HOST) {
  await db.init();
  await seed.ensureSeeded();
  const timer = ticker.start();
  return new Promise((resolve) => server.listen(port, host, () => {
    const addr = server.address();
    console.log(`\nHệ thống Báo giá nông sản đang chạy:  http://${host === '0.0.0.0' ? 'localhost' : host}:${addr.port}`);
    console.log(`Cơ sở dữ liệu: PostgreSQL ${String(db.url).replace(/:[^:@/]*@/, ':***@')}`);
    resolve({ server, timer, port: addr.port });
  }));
}

if (require.main === module) start().catch((e) => { console.error('Không khởi động được:', e.message); process.exit(1); });
module.exports = { start, server };
