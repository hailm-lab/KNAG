'use strict';
/* Cơ sở dữ liệu PostgreSQL (thư viện pg).
   - docs: mỗi bản ghi nghiệp vụ là một tài liệu JSONB có số phiên bản (ver) để chống ghi đè khi nhiều người cùng sửa.
   - changes: nhật ký thay đổi theo số thứ tự, dùng cho đồng bộ gia tăng (/api/changes). Ghi thay đổi luôn qua khóa tư vấn
     (pg_advisory_xact_lock) để số thứ tự được "chốt" đúng thứ tự, trình duyệt không bao giờ bỏ sót thay đổi.
   - credentials, sessions, reset_tokens, rate: đăng nhập, phiên, đặt lại mật khẩu, giới hạn tần suất.
   - audit: nhật ký thao tác ghi dữ liệu (ai, lúc nào, thay đổi gì).
   Chuỗi kết nối lấy từ DATABASE_URL; nếu không đặt thì dùng PostgreSQL riêng của dự án (server/pg-local.js). */
const { Pool } = require('pg');

let pool = null; let connString = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (k text PRIMARY KEY, v text);
CREATE TABLE IF NOT EXISTS docs (
  c text NOT NULL, id text NOT NULL, json jsonb NOT NULL, ver integer NOT NULL DEFAULT 1,
  upd timestamptz NOT NULL DEFAULT now(), by text, PRIMARY KEY (c, id)
);
CREATE INDEX IF NOT EXISTS ix_docs_date ON docs (c, (json->>'date'));
CREATE INDEX IF NOT EXISTS ix_docs_xa ON docs (c, (json->>'xa'));
CREATE TABLE IF NOT EXISTS changes (
  seq bigserial PRIMARY KEY, c text NOT NULL, id text NOT NULL, op text NOT NULL, ver integer, at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_changes_key ON changes (c, id);
CREATE TABLE IF NOT EXISTS credentials (
  user_id text PRIMARY KEY, salt text NOT NULL, hash text NOT NULL, fails integer NOT NULL DEFAULT 0,
  locked_until timestamptz, changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  sid text PRIMARY KEY, user_id text NOT NULL, created timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(), ip text, ua text
);
CREATE INDEX IF NOT EXISTS ix_sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS reset_tokens (
  tid text PRIMARY KEY, user_id text NOT NULL, exp timestamptz NOT NULL, used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS rate (k text PRIMARY KEY, n integer NOT NULL, since timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit (
  seq bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), user_id text, who text, level text, c text, id text, op text, summary text, ip text
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit (at);
`;

/** Kết nối và tạo bảng nếu chưa có. Gọi một lần khi khởi động */
async function init(url) {
  if (pool) return pool;
  connString = url || process.env.DATABASE_URL || await require('./pg-local').ensure();
  pool = new Pool({ connectionString: connString, max: +(process.env.BG_PG_POOL || 10), ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined });
  pool.on('error', (e) => console.error('Lỗi kết nối PostgreSQL:', e.message));
  await pool.query(SCHEMA);
  return pool;
}
async function close() { if (pool) { const p = pool; pool = null; await p.end(); } }
const query = (text, params) => pool.query(text, params);

/** Giao dịch. Với write=true: trong cùng một tiến trình các giao dịch ghi xếp hàng (không chiếm kết nối khi chờ, tránh nghẽn hồ kết nối),
    giữa nhiều tiến trình thì dùng khóa tư vấn của PostgreSQL; nhờ vậy mọi giao dịch ghi được chốt tuần tự và số thay đổi luôn đúng thứ tự */
let writeChain = Promise.resolve();
async function tx(fn, write = true) {
  if (!write) return txRun(fn, false);
  const prev = writeChain; let release; writeChain = new Promise((r) => { release = r; });
  await prev.catch(() => { });
  try { return await txRun(fn, true); } finally { release(); }
}
async function txRun(fn, write) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (write) await c.query('SELECT pg_advisory_xact_lock(7340)');
    const r = await fn(c); await c.query('COMMIT'); touched.forEach(onWrite); touched.clear(); return r;
  } catch (e) { touched.clear(); try { await c.query('ROLLBACK'); } catch (e2) { /* đã hoàn tác */ } throw e; } finally { c.release(); }
}

let onWrite = () => { };                                   // domain.js đăng ký để xóa bộ nhớ đệm giờ / cấu hình khi bgSys, bgCfg thay đổi
const hook = (fn) => { onWrite = fn; };
const touched = new Set();                                 // collection đã ghi trong giao dịch đang chạy; chỉ báo cho bộ nhớ đệm sau khi COMMIT
const touch = (c, cl) => { if (cl) touched.add(c); else onWrite(c); };
const exec = (cl) => (cl ? cl.query.bind(cl) : pool.query.bind(pool));

const docs = {
  async get(c, id) { const r = await pool.query('SELECT json, ver FROM docs WHERE c = $1 AND id = $2', [c, id]); return r.rowCount ? { doc: r.rows[0].json, ver: r.rows[0].ver } : null; },
  async all(c) { const r = await pool.query('SELECT id, json, ver FROM docs WHERE c = $1', [c]); return r.rows.map((x) => ({ id: x.id, doc: x.json, ver: x.ver })); },
  /** Ghi (thêm / sửa) không kiểm tra phiên bản, dùng cho tác vụ hệ thống và nạp dữ liệu. Trả về phiên bản mới */
  async put(c, id, doc, by, cl) {
    const q = exec(cl);
    const r = await q(`INSERT INTO docs (c, id, json, ver, by) VALUES ($1, $2, $3::jsonb, 1, $4)
      ON CONFLICT (c, id) DO UPDATE SET json = excluded.json, ver = docs.ver + 1, upd = now(), by = excluded.by RETURNING ver`, [c, id, JSON.stringify(doc), by || null]);
    await q('INSERT INTO changes (c, id, op, ver) VALUES ($1, $2, $3, $4)', [c, id, 'put', r.rows[0].ver]); touch(c, cl); return r.rows[0].ver;
  },
  /** Ghi có kiểm tra phiên bản: base = phiên bản trình duyệt đang giữ (0 = bản ghi mới). Trả về {ver} hoặc {conflict:true} */
  async putChecked(c, id, doc, by, base, cl) {
    const q = exec(cl); let r;
    if (base) r = await q('UPDATE docs SET json = $3::jsonb, ver = ver + 1, upd = now(), by = $4 WHERE c = $1 AND id = $2 AND ver = $5 RETURNING ver', [c, id, JSON.stringify(doc), by || null, base]);
    else r = await q('INSERT INTO docs (c, id, json, ver, by) VALUES ($1, $2, $3::jsonb, 1, $4) ON CONFLICT (c, id) DO NOTHING RETURNING ver', [c, id, JSON.stringify(doc), by || null]);
    if (!r.rowCount) return { conflict: true };
    await q('INSERT INTO changes (c, id, op, ver) VALUES ($1, $2, $3, $4)', [c, id, 'put', r.rows[0].ver]); touch(c, cl); return { ver: r.rows[0].ver };
  },
  async del(c, id, cl) { const q = exec(cl); const r = await q('DELETE FROM docs WHERE c = $1 AND id = $2', [c, id]); if (r.rowCount) { await q('INSERT INTO changes (c, id, op, ver) VALUES ($1, $2, $3, 0)', [c, id, 'del']); touch(c, cl); } },
  async cursor() { const r = await pool.query('SELECT COALESCE(MAX(seq), 0)::bigint AS m FROM changes'); return Number(r.rows[0].m); },
  async changesSince(seq) { const r = await pool.query('SELECT seq::bigint AS seq, c, id, op, ver FROM changes WHERE seq > $1 ORDER BY seq LIMIT 5000', [seq]); return r.rows.map((x) => ({ ...x, seq: Number(x.seq) })); },
  async count() { const r = await pool.query('SELECT COUNT(*)::int AS n FROM docs'); return r.rows[0].n; },
};

async function audit(ctx, c, id, op, summary, ip) {
  try {
    await pool.query('INSERT INTO audit (user_id, who, level, c, id, op, summary, ip) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
      [ctx && ctx.user ? ctx.user.id : null, ctx && ctx.user ? ctx.user.ten : 'Hệ thống', ctx ? ctx.level || null : null, c, id, op, String(summary || '').slice(0, 300), ip || null]);
  } catch (e) { console.error('Không ghi được nhật ký:', e.message); }
}

const meta = {
  async get(k) { const r = await pool.query('SELECT v FROM meta WHERE k = $1', [k]); return r.rowCount ? r.rows[0].v : null; },
  async set(k, v) { await pool.query('INSERT INTO meta (k, v) VALUES ($1, $2) ON CONFLICT (k) DO UPDATE SET v = excluded.v', [k, String(v)]); },
};

module.exports = { init, close, query, tx, docs, audit, meta, hook, get url() { return connString; } };
