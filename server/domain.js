'use strict';
/* Quy tắc thời gian của module Báo giá, tính trên MÁY CHỦ (không tin đồng hồ của trình duyệt).
   Đồng hồ nghiệp vụ lấy từ tài liệu bgSys.clock (chỉ Admin được đổi). Mặc định đặt theo ngày dữ liệu mẫu để dữ liệu 14–15/10/2026 còn ý nghĩa.
   Cấu hình và đồng hồ được giữ trong bộ nhớ đệm 1 giây và xóa ngay khi có ghi vào bgCfg / bgSys. */
const { docs, hook } = require('./db');

const pad = (n) => String(n).padStart(2, '0');
const parseLocal = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(s || '')); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : new Date(NaN); };
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (s, n) => { const d = parseLocal(s); d.setDate(d.getDate() + n); return dstr(d); };
const dow = (s) => { const w = parseLocal(s).getDay(); return w === 0 ? 7 : w; };

const DEF_CFG = { lock: '12:00', replyBy: '13:30', days: [1, 2, 3, 4, 5], holidays: [], extraDays: [], remind1: '07:30', remind2: '10:30' };
let cache = { t: 0, cfg: null, sys: null };
hook((c) => { if (c === 'bgCfg' || c === 'bgSys') cache.t = 0; });
async function load() {
  if (Date.now() - cache.t < 1000 && cache.sys) return;
  const [c, s] = await Promise.all([docs.get('bgCfg', 'cfg'), docs.get('bgSys', 'sys')]);
  cache = { t: Date.now(), cfg: c ? c.doc : DEF_CFG, sys: s ? s.doc : { clock: new Date().toISOString().slice(0, 16) } };
}
const cfg = async () => { await load(); return cache.cfg; };
const sys = async () => { await load(); return cache.sys; };
const clock = async () => (await sys()).clock;              // 'YYYY-MM-DDTHH:mm'
const today = async () => (await clock()).slice(0, 10);

async function isDay(date) {
  const c = await cfg();
  if ((c.extraDays || []).some((x) => x.date === date)) return true;
  if ((c.holidays || []).some((x) => x.date === date)) return false;
  return (c.days || []).includes(dow(date));
}
/** Đã qua giờ khóa của ngày báo giá (ngày quá khứ luôn khóa) */
async function locked(date) { const [ck, c] = await Promise.all([clock(), cfg()]); return date < ck.slice(0, 10) || parseLocal(ck) >= parseLocal(`${date}T${c.lock}`); }

module.exports = { cfg, sys, clock, today, isDay, locked, parseLocal, dstr, addDays, dow };
