'use strict';
/* Đồng bộ dữ liệu giữa máy chủ và trình duyệt:
   - buildState: trạng thái ban đầu theo vai trò (đã thu hẹp dữ liệu).
   - applyOps: nhận các thay đổi trình duyệt gửi lên, mỗi thay đổi được kiểm tra quyền, phiên bản, dữ liệu hợp lệ; chấp nhận hoặc từ chối riêng từng thay đổi.
     Mỗi thay đổi là một giao dịch PostgreSQL riêng, ghi tuần tự qua khóa tư vấn.
   - changesSince: các thay đổi của người khác kể từ lần đồng bộ trước (đã thu hẹp theo vai trò). */
const { docs, tx, audit, query } = require('./db');
const auth = require('./auth');
const P = require('./policy');
const D = require('./domain');

const MAX_DOC = 300 * 1024;

async function buildState(ctx) {
  const out = { db: {}, vers: {} }; const cols = [...P.SYNCED];
  cols.forEach((c) => { out.db[c] = []; out.vers[c] = {}; });
  const r = await query('SELECT c, id, json, ver FROM docs WHERE c = ANY($1)', [cols]);
  for (const x of r.rows) { const d = P.readScope(ctx, x.c, x.json); if (d) { out.db[x.c].push(d); out.vers[x.c][x.id] = x.ver; } }
  out.cursor = await docs.cursor(); out.clock = await D.clock();
  return out;
}

function summarize(c, id, op, old, nu) {
  if (op === 'del') return `Xóa ${c}/${id}`;
  if (!old) return `Thêm ${c}/${id}`;
  const ks = Object.keys(nu).filter((k) => k !== 'log' && JSON.stringify(old[k]) !== JSON.stringify(nu[k]));
  return `Sửa ${c}/${id}${ks.length ? ': ' + ks.slice(0, 6).join(', ') : ''}`;
}

/** ops: [{c, id, op: 'put'|'del', base, doc}] → [{c, id, ok, ver} | {c, id, ok:false, code, msg, doc?, ver?}] */
async function applyOps(ctx, ops, ip) {
  const results = [];
  for (const o of ops) {
    const r = { c: o.c, id: o.id, ok: false };
    try {
      if (!P.SYNCED.has(o.c) || typeof o.id !== 'string' || !o.id) { r.code = 'invalid'; r.msg = 'Thao tác không hợp lệ.'; results.push(r); continue; }
      if (o.op === 'put' && (!o.doc || typeof o.doc !== 'object' || o.doc.id !== o.id)) { r.code = 'invalid'; r.msg = 'Bản ghi không hợp lệ.'; results.push(r); continue; }
      if (o.op === 'put' && JSON.stringify(o.doc).length > MAX_DOC) { r.code = 'invalid'; r.msg = 'Bản ghi quá lớn.'; results.push(r); continue; }
      const done = await tx(async (cl) => {
        const cur = await docs.get(o.c, o.id);                // đã nằm trong khóa tư vấn nên không ai ghi chen ngang
        if (o.op === 'put') {
          const nu = { ...o.doc };
          const newPw = o.c === 'users' && typeof nu.pw === 'string' && nu.pw ? nu.pw : null; if (o.c === 'users') { delete nu.pw; if (newPw) nu.mustChange = true; }   // mật khẩu không bao giờ lưu trong tài liệu; chỉ băm vào bảng credentials sau khi qua kiểm tra quyền
          const why = await P.checkWrite(ctx, o.c, 'put', cur ? cur.doc : null, nu);          // quyền kiểm tra trước, rồi mới đến xung đột phiên bản
          if (why) return { denied: why };
          if (cur && o.base !== cur.ver) return { conflict: true, cur };
          if (!cur && o.base) return { conflict: true, cur: null };
          const w = await docs.putChecked(o.c, o.id, nu, ctx.user.id, cur ? cur.ver : 0, cl);
          if (w.conflict) return { conflict: true, cur };
          if (newPw) await auth.setPassword(nu.id, newPw, cl);
          await audit(ctx, o.c, o.id, cur ? 'update' : 'create', summarize(o.c, o.id, 'put', cur && cur.doc, nu), ip);
          return { ver: w.ver };
        }
        if (o.op === 'del') {
          if (!cur) return { ver: 0 };
          const why = await P.checkWrite(ctx, o.c, 'del', cur.doc, null);
          if (why) return { denied: why };
          await docs.del(o.c, o.id, cl); await audit(ctx, o.c, o.id, 'delete', summarize(o.c, o.id, 'del'), ip); return { ver: 0 };
        }
        return { denied: 'Thao tác không hợp lệ.' };
      });
      if (done.denied) { r.code = 'forbidden'; r.msg = done.denied; const cur = await docs.get(o.c, o.id); if (cur) { const sd = P.readScope(ctx, o.c, cur.doc); if (sd) { r.doc = sd; r.ver = cur.ver; } } else r.gone = true; }
      else if (done.conflict) { r.code = 'conflict'; r.msg = 'Dữ liệu vừa được người khác cập nhật.'; if (done.cur) { const sd = P.readScope(ctx, o.c, done.cur.doc); if (sd) { r.doc = sd; r.ver = done.cur.ver; } } else r.gone = true; }
      else { r.ok = true; r.ver = done.ver; }
    } catch (e) { console.error('applyOps lỗi', o.c, o.id, e); r.code = 'error'; r.msg = 'Lỗi máy chủ.'; }
    results.push(r);
  }
  return results;
}

/** Thay đổi của người khác kể từ since. Trả về {cursor, put:[{c,id,ver,doc}], del:[{c,id}], clock} */
async function changesSince(ctx, since) {
  const rows = await docs.changesSince(since); const put = []; const del = []; const seen = new Set(); const need = {};
  let cursor = since;
  for (let i = rows.length - 1; i >= 0; i--) {                    // lấy bản mới nhất của mỗi tài liệu
    const r = rows[i]; const key = r.c + '|' + r.id; if (seen.has(key)) continue; seen.add(key);
    if (r.op === 'del') { del.push({ c: r.c, id: r.id }); continue; }
    (need[r.c] || (need[r.c] = [])).push(r.id);
  }
  for (const c of Object.keys(need)) {
    const res = await query('SELECT id, json, ver FROM docs WHERE c = $1 AND id = ANY($2)', [c, need[c]]); const got = new Set();
    for (const x of res.rows) { got.add(x.id); const sd = P.readScope(ctx, c, x.json); if (sd) put.push({ c, id: x.id, ver: x.ver, doc: sd }); else del.push({ c, id: x.id }); }   // tài liệu không còn nằm trong phạm vi xem
    need[c].forEach((id) => { if (!got.has(id)) del.push({ c, id }); });
  }
  if (rows.length) cursor = rows[rows.length - 1].seq;
  return { cursor, put, del, clock: await D.clock(), more: rows.length >= 5000 };
}

module.exports = { buildState, applyOps, changesSince };
