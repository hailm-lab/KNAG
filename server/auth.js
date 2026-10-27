'use strict';
/* Xác thực: mật khẩu băm scrypt + muối riêng, phiên đăng nhập qua cookie HttpOnly, khóa tạm khi sai nhiều lần.
   Theo BRD FN-AD-01.01: đăng nhập bằng email / số điện thoại / tên đăng nhập; web hết phiên sau 4 giờ không thao tác;
   quên mật khẩu: link hiệu lực 30 phút, dùng một lần, tối đa 5 yêu cầu mỗi giờ. */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query, tx, docs, audit } = require('./db');

const IDLE_MS = 4 * 3600 * 1000;           // BRD: 4 giờ không thao tác trên Web
const MAX_FAILS = 5; const LOCK_MIN = 15;  // sai 5 lần → khóa 15 phút
const RESET_MIN = 30; const RESET_PER_HOUR = 5;

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const scrypt = (pw, salt) => crypto.scryptSync(String(pw), salt, 64).toString('hex');
const rnd = (n = 32) => crypto.randomBytes(n).toString('hex');

async function setPassword(userId, pw, cl) {
  const salt = rnd(16);
  await (cl || { query }).query(`INSERT INTO credentials (user_id, salt, hash, fails, locked_until, changed_at) VALUES ($1, $2, $3, 0, NULL, now())
    ON CONFLICT (user_id) DO UPDATE SET salt = excluded.salt, hash = excluded.hash, fails = 0, locked_until = NULL, changed_at = now()`, [userId, salt, scrypt(pw, salt)]);
}
async function checkPassword(userId, pw) {
  const r = await query('SELECT salt, hash FROM credentials WHERE user_id = $1', [userId]); if (!r.rowCount) return false;
  const a = Buffer.from(scrypt(pw, r.rows[0].salt), 'hex'); const b = Buffer.from(r.rows[0].hash, 'hex'); return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Tìm tài khoản theo tên đăng nhập / email / số điện thoại (không phân biệt hoa thường, bỏ khoảng trắng) */
async function findUser(key) {
  const k = String(key || '').trim().toLowerCase().replace(/\s/g, ''); if (!k) return null;
  const r = await query(`SELECT json FROM docs WHERE c = 'users' AND COALESCE((json->>'noLogin')::boolean, false) = false
    AND (lower(json->>'username') = $1 OR lower(json->>'email') = $1 OR json->>'phone' = $1) LIMIT 1`, [k]);
  return r.rowCount ? r.rows[0].json : null;
}

/** Giới hạn tần suất theo khóa (ví dụ IP): tối đa max lần trong windowMin phút */
async function rateHit(key, max, windowMin) {
  const r = await query('SELECT n, since FROM rate WHERE k = $1', [key]); const now = Date.now();
  if (!r.rowCount || now - new Date(r.rows[0].since).getTime() > windowMin * 60000) { await query('INSERT INTO rate (k, n, since) VALUES ($1, 1, now()) ON CONFLICT (k) DO UPDATE SET n = 1, since = now()', [key]); return true; }
  if (r.rows[0].n >= max) return false; await query('UPDATE rate SET n = n + 1 WHERE k = $1', [key]); return true;
}

/** Đăng nhập. Trả về {ok, user, sid} hoặc {ok:false, code, msg, left?, until?} */
async function login(key, pw, ip, ua) {
  if (!(await rateHit('ip:' + ip, 60, 10))) return { ok: false, code: 429, msg: 'Quá nhiều lần thử từ địa chỉ này, vui lòng thử lại sau ít phút.' };
  const u = await findUser(key);
  if (!u) return { ok: false, code: 401, msg: 'Email/số điện thoại hoặc mật khẩu không đúng.' };
  const cr = await query('SELECT fails, locked_until FROM credentials WHERE user_id = $1', [u.id]); const c = cr.rows[0];
  if (c && c.locked_until && new Date(c.locked_until).getTime() > Date.now()) return { ok: false, code: 423, msg: 'Tài khoản bị khóa tạm do nhập sai nhiều lần.', until: new Date(c.locked_until).toISOString() };
  if (!(await checkPassword(u.id, pw))) {
    const fails = (c ? c.fails : 0) + 1;
    if (fails >= MAX_FAILS) { const until = new Date(Date.now() + LOCK_MIN * 60000).toISOString(); await query('UPDATE credentials SET fails = 0, locked_until = $2 WHERE user_id = $1', [u.id, until]); await audit({ user: u }, 'users', u.id, 'lock', 'Khóa tạm do sai mật khẩu 5 lần', ip); return { ok: false, code: 423, msg: 'Tài khoản bị khóa tạm do nhập sai 5 lần.', until }; }
    await query('UPDATE credentials SET fails = $2 WHERE user_id = $1', [u.id, fails]); return { ok: false, code: 401, msg: 'Email/số điện thoại hoặc mật khẩu không đúng.', left: MAX_FAILS - fails };
  }
  if (!u.active) return { ok: false, code: 403, msg: 'Tài khoản đang bị khóa. Vui lòng liên hệ Admin.' };
  await query('UPDATE credentials SET fails = 0, locked_until = NULL WHERE user_id = $1', [u.id]);
  const sid = rnd(32); await query('INSERT INTO sessions (sid, user_id, ip, ua) VALUES ($1, $2, $3, $4)', [sha(sid), u.id, ip, String(ua || '').slice(0, 200)]);
  await audit({ user: u }, 'users', u.id, 'login', 'Đăng nhập', ip);
  return { ok: true, user: u, sid };
}

/** Phiên theo cookie; quá 4 giờ không thao tác thì hết hạn */
async function getSession(sid) {
  if (!sid) return null; const r = await query('SELECT sid, user_id, last_seen FROM sessions WHERE sid = $1', [sha(sid)]); if (!r.rowCount) return null;
  const s = r.rows[0]; const age = Date.now() - new Date(s.last_seen).getTime();
  if (age > IDLE_MS) { await query('DELETE FROM sessions WHERE sid = $1', [s.sid]); return null; }
  if (age > 30000) await query('UPDATE sessions SET last_seen = now() WHERE sid = $1', [s.sid]);
  const u = await docs.get('users', s.user_id); if (!u || !u.doc.active) return null;
  return { user: u.doc, sid: s.sid };
}
async function logout(sid) { if (sid) await query('DELETE FROM sessions WHERE sid = $1', [sha(sid)]); }
async function logoutAll(userId, cl) { await (cl || { query }).query('DELETE FROM sessions WHERE user_id = $1', [userId]); }

function passwordRule(pw) {
  const s = String(pw || '');
  if (s.length < 8) return 'Mật khẩu mới cần từ 8 ký tự.';
  if (!/[A-Za-z]/.test(s) || !/\d/.test(s)) return 'Mật khẩu mới cần có cả chữ và số.';
  return null;
}
async function changePassword(user, oldPw, newPw) {
  if (!(await checkPassword(user.id, oldPw))) return { ok: false, msg: 'Mật khẩu hiện tại không đúng.' };
  const err = passwordRule(newPw); if (err) return { ok: false, msg: err };
  await setPassword(user.id, newPw); return { ok: true };
}

/* ---- Quên mật khẩu: thư gửi được MÔ PHỎNG, nội dung ghi vào tệp outbox.log (bản demo không có máy chủ thư) ---- */
const OUTBOX = path.join(process.env.BG_OUTBOX_DIR || path.join(__dirname, '..', 'data'), 'outbox.log');
async function requestReset(email, baseUrl, ip) {
  const u = await findUser(email);
  if (!u || !u.email || u.email.toLowerCase() !== String(email).trim().toLowerCase()) return { ok: true };   // không tiết lộ email có tồn tại hay không
  if (!(await rateHit('reset:' + u.id, RESET_PER_HOUR, 60))) return { ok: false, code: 429, msg: 'Đã đạt tối đa 5 yêu cầu mỗi giờ.' };
  const token = rnd(24); await query('INSERT INTO reset_tokens (tid, user_id, exp) VALUES ($1, $2, $3)', [sha(token), u.id, new Date(Date.now() + RESET_MIN * 60000).toISOString()]);
  const line = `[${new Date().toISOString()}] GỬI THƯ (mô phỏng) tới ${u.email}: link đặt lại mật khẩu, hiệu lực ${RESET_MIN} phút, dùng một lần: ${baseUrl}/#/reset/${token}\n`;
  try { fs.mkdirSync(path.dirname(OUTBOX), { recursive: true }); fs.appendFileSync(OUTBOX, line); } catch (e) { /* bỏ qua */ }
  console.log(line.trim()); await audit({ user: u }, 'users', u.id, 'reset-request', 'Yêu cầu đặt lại mật khẩu', ip);
  return { ok: true };
}
async function applyReset(token, newPw) {
  const r = await query('SELECT tid, user_id, exp, used FROM reset_tokens WHERE tid = $1', [sha(token || '')]); const t = r.rows[0];
  if (!t || t.used || new Date(t.exp).getTime() < Date.now()) return { ok: false, msg: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' };
  const err = passwordRule(newPw); if (err) return { ok: false, msg: err };
  return tx(async (cl) => {
    const u = await cl.query('UPDATE reset_tokens SET used = true WHERE tid = $1 AND used = false', [t.tid]);
    if (!u.rowCount) return { ok: false, msg: 'Link đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.' };       // hai yêu cầu cùng lúc: chỉ một yêu cầu thắng
    await setPassword(t.user_id, newPw, cl); await logoutAll(t.user_id, cl); return { ok: true };
  }, false);
}

module.exports = { login, getSession, logout, logoutAll, setPassword, checkPassword, changePassword, requestReset, applyReset, findUser, passwordRule, sha, OUTBOX };
