'use strict';
/* Tác vụ theo thời gian chạy trên MÁY CHỦ (một nơi duy nhất, không bị lặp khi nhiều người cùng mở):
   1) áp dụng cấu hình đã hẹn ngày hiệu lực (lịch / giờ khóa / giờ nhắc) và thay đổi xã, cán bộ Xã đã hẹn;
   2) sinh nhắc nhập giá lần 1, lần 2 cho các xã chưa gửi (FN-XA-03.04), gửi thông báo trong ứng dụng;
   3) chế độ đồng hồ "chạy theo giờ thực".
   Id bản ghi được đặt cố định theo (xã, ngày, lần) nên chạy lại nhiều lần cũng không sinh trùng. */
const { docs, tx, audit, query } = require('./db');
const D = require('./domain');

const fmtDate = (d) => d.split('-').reverse().join('/');

async function applyConfig() {
  const pre = await docs.get('bgCfg', 'cfg'); if (!pre) return false; const today0 = await D.today();
  if (!(pre.doc.pending && today0 >= pre.doc.pending.effFrom) && !(pre.doc.rnext && today0 >= pre.doc.rnext.from)) return false;
  const changed = await tx(async (cl) => {                                // đọc lại trong giao dịch rồi mới áp dụng
    const r = await docs.get('bgCfg', 'cfg'); if (!r) return false; const c = { ...r.doc }; const today = await D.today(); let ch = false;
    if (c.pending && today >= c.pending.effFrom) { Object.assign(c, { lock: c.pending.lock, replyBy: c.pending.replyBy, days: c.pending.days, effFrom: c.pending.effFrom }); c.pending = null; ch = true; }
    if (c.rnext && today >= c.rnext.from) { Object.assign(c, { remind1: c.rnext.remind1, remind2: c.rnext.remind2, remindText: c.rnext.remindText, channels: c.rnext.channels }); c.rnext = null; ch = true; }
    if (ch) await docs.put('bgCfg', 'cfg', c, 'system', cl);
    return ch;
  });
  if (changed) await audit(null, 'bgCfg', 'cfg', 'update', 'Áp dụng cấu hình đã hẹn ngày hiệu lực');
  return changed;
}

/** Tới ngày hiệu lực: bật xã mới, áp dụng cán bộ Xã đã hẹn (giống BG.assignCb của giao diện nhưng chạy ở máy chủ) */
const tRole = (u, lv) => ((u && u.roles) || []).find((r) => r.level === lv && (r.depts || []).includes('tttt'));
async function adminPending() {
  const today = await D.today(); let n = 0;
  for (const { id, doc } of await docs.all('bgXa')) {
    if (!(doc.status === 'cho' && doc.from <= today) && !(doc.cbNext && doc.cbNext.from <= today)) continue;
    const did = await tx(async (cl) => {
      const cur = await docs.get('bgXa', id); if (!cur) return false; const x = { ...cur.doc }; let ch = false;   // đọc lại trong giao dịch
      if (x.status === 'cho' && x.from <= today) { x.status = 'active'; ch = true; }
      if (x.cbNext && x.cbNext.from <= today) {
        const userId = x.cbNext.user; const from = x.cbNext.from; const old = x.cb; const hist = (x.cbHist || []).map((h) => ({ ...h })); const curH = hist.find((h) => !h.to);
        if (curH && curH.user !== userId) { const end = D.addDays(from, -1); curH.to = end < curH.from ? curH.from : end; }
        if (!curH || curH.user !== userId) hist.push({ user: userId, from, to: null });
        x.cbHist = hist; x.cb = userId; x.cbNext = null; ch = true;
        if (old && old !== userId) { const ou = await docs.get('users', old); const r = ou && tRole(ou.doc, 'xa'); if (r) { r.bgXa = (r.bgXa || []).filter((i) => i !== x.id); await docs.put('users', old, ou.doc, 'system', cl); } }
        const nu = await docs.get('users', userId);
        if (nu) { let r = tRole(nu.doc, 'xa'); if (!r) { r = { level: 'xa', depts: ['tttt'], unit: 'TTKN tỉnh An Giang', bgXa: [] }; nu.doc.roles.push(r); } if (!(r.bgXa || []).includes(x.id)) (r.bgXa = r.bgXa || []).push(x.id); await docs.put('users', userId, nu.doc, 'system', cl); }
      }
      if (ch) await docs.put('bgXa', x.id, x, 'system', cl);
      return ch;
    });
    if (did) { await audit(null, 'bgXa', id, 'update', 'Áp dụng thay đổi đã hẹn ngày hiệu lực (xã / cán bộ Xã)'); n++; }
  }
  return n;
}

/** Chế độ đồng hồ 'real': bgSys.clock chạy theo giờ thực của máy chủ (cập nhật mỗi phút) */
async function realClock() {
  const pre = await docs.get('bgSys', 'sys'); if (!pre || pre.doc.mode !== 'real') return false;
  return tx(async (cl) => {                                               // đọc lại trong giao dịch: nếu Admin vừa đổi chế độ thì không ghi đè
    const r = await docs.get('bgSys', 'sys'); if (!r || r.doc.mode !== 'real') return false;
    const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const now = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
    if (r.doc.clock === now) return false; await docs.put('bgSys', 'sys', { ...r.doc, clock: now }, 'system', cl); return true;
  });
}

async function reminders() {
  const today = await D.today(); if (!(await D.isDay(today)) || (await D.locked(today))) return 0;
  const c = await D.cfg(); const now = D.parseLocal(await D.clock()); let made = 0;
  for (const { doc: x } of await docs.all('bgXa')) {
    if (x.status !== 'active') continue;
    for (const [w, t] of [['1', c.remind1], ['2', c.remind2]]) {
      if (!t || now < D.parseLocal(`${today}T${t}`)) continue;
      const rid = `rm|${x.id}|${today}|${w}`;
      const pr = await query("SELECT json FROM docs WHERE c = 'bgPhieu' AND json->>'xa' = $1 AND json->>'date' = $2 AND json->>'st' <> 'del' LIMIT 1", [x.id, today]);
      const p = pr.rowCount ? pr.rows[0].json : null;
      if (p && p.st === 'sent') continue;                                   // không nhắc xã đã gửi
      if (w === '2' && !(p === null || p.st === 'draft')) continue;
      const txt = String(c.remindText || 'Nhắc nhập giá nông sản ngày {ngày} của {xã} trước {giờ khóa}.').replace('{ngày}', fmtDate(today)).replace('{xã}', x.ten).replace('{giờ khóa}', c.lock);
      const cbu = x.cb ? await docs.get('users', x.cb) : null;
      const made1 = await tx(async (cl) => {
        const dup = await query("SELECT 1 FROM docs WHERE c = 'bgRemind' AND (id = $1 OR (json->>'xa' = $2 AND json->>'date' = $3 AND json->>'which' = $4)) LIMIT 1", [rid, x.id, today, w]);
        if (dup.rowCount) return false;                                                            // kể cả nhắc đã có từ dữ liệu mẫu
        await docs.put('bgRemind', rid, { id: rid, xa: x.id, date: today, which: w, at: `${today}T${t}`, text: txt, channel: cbu && cbu.doc.email ? 'Trong ứng dụng, email' : 'Trong ứng dụng' }, 'system', cl);
        if (x.cb) { const nid = `nt|${rid}`; await docs.put('notifs', nid, { id: nid, to: x.cb, title: `Nhắc nhập giá lần ${w}`, body: txt, dept: 'tttt', level: 'xa', link: { s: 'bg-entry', p: {} }, kind: 'remind', at: await D.clock(), read: false }, 'system', cl); }
        return true;
      });
      if (made1) made++;
    }
  }
  if (made) await audit(null, 'bgRemind', today, 'create', `Sinh ${made} nhắc nhập giá`);
  return made;
}

let running = false;
async function tick() {
  if (running) return; running = true;
  try { await realClock(); await applyConfig(); await adminPending(); await reminders(); } catch (e) { console.error('ticker lỗi', e); } finally { running = false; }
}
function start(ms = 10000) { tick(); const t = setInterval(tick, ms); t.unref && t.unref(); return t; }

module.exports = { start, tick, applyConfig, reminders, adminPending, realClock };
