'use strict';
/* Phân quyền phía máy chủ: AI được ĐỌC gì (thu hẹp dữ liệu theo vai trò) và AI được GHI gì (quy tắc theo từng loại dữ liệu).
   Vai trò đang dùng do trình duyệt gửi kèm mỗi yêu cầu (X-Role: chỉ số vai trò|phòng ban) và được kiểm tra lại với danh sách vai trò của tài khoản.
   Ma trận phân quyền đầy đủ: docs/RBAC.md. */
const { docs, query } = require('./db');
const D = require('./domain');

const OPERATIONAL = ['bgPhieu', 'bgAlert', 'bgBoard', 'bgProp', 'bgRemind', 'bgLog', 'bgLock', 'bgSyn', 'bgRound', 'bgSrv', 'bgItem', 'bgGroup', 'bgSet', 'bgCfg', 'bgXa', 'bgSys', 'prCat', 'prRep'];
const SYNCED = new Set(['xa', 'depts', 'users', 'notifs'].concat(OPERATIONAL));

/** Ngữ cảnh người dùng: tài khoản + vai trò đang chọn */
function makeCtx(user, roleHeader) {
  const ctx = { user, role: null, level: null, dept: null, qtnv: false, isAdmin: false, xaIds: [] };
  const m = /^(\d+)\|([a-z]+)$/.exec(String(roleHeader || ''));
  if (!m) return ctx;
  const role = (user.roles || [])[+m[1]]; if (!role || !(role.depts || []).includes(m[2])) return ctx;
  ctx.role = role; ctx.level = role.level; ctx.dept = m[2]; ctx.isAdmin = role.level === 'admin';
  ctx.qtnv = ctx.isAdmin || !!((role.qtnv || {}).tttt); ctx.xaIds = (role.bgXa || []).slice();
  return ctx;
}

const strip = (o, keys) => { const c = { ...o }; keys.forEach((k) => delete c[k]); return c; };
const isStaff = (ctx) => ctx.level === 'tinh' || ctx.isAdmin;

/* ------------------------------------------------------------------ ĐỌC ------------------------------------------------------------------ */
/** Trả về bản ghi đã thu hẹp theo vai trò, hoặc null nếu vai trò này không được xem */
function readScope(ctx, c, doc) {
  if (!ctx.level) return null;
  switch (c) {
    case 'xa': case 'depts': case 'bgSys': case 'bgCfg': case 'bgGroup': case 'bgItem': case 'bgSet': case 'bgXa': return doc;
    case 'users': return strip(doc, ['pw']);
    case 'notifs': return doc.to === ctx.user.id ? doc : null;
    case 'bgBoard': return isStaff(ctx) ? doc : strip(doc, ['log']);                      // bảng giá đã công bố ai cũng xem; nhật ký chỉ Cấp Tỉnh / Admin
    case 'bgPhieu': case 'bgRemind': case 'bgProp':
      if (isStaff(ctx)) return doc;
      return ctx.level === 'xa' && ctx.xaIds.includes(doc.xa) ? doc : null;               // Cấp Xã chỉ thấy xã của mình; Cấp TW không thấy phiếu từng xã
    case 'bgAlert':
      if (isStaff(ctx)) return doc;
      if (ctx.level === 'xa') return ctx.xaIds.includes(doc.xa) ? doc : null;
      if (ctx.level === 'tw') return { id: doc.id, xa: doc.xa, date: doc.date, item: doc.item, kind: doc.kind, pct: doc.pct, st: doc.st };   // chỉ để đếm số lần vượt ngưỡng
      return null;
    case 'bgRound':
      if (isStaff(ctx)) return doc;
      if (ctx.level === 'tw') return { ...doc, xas: (doc.xas || []).map((x) => ({ ...x, officers: (x.officers || []).map((o) => strip(o, ['sdt'])) })), log: [] };
      return null;
    case 'bgSrv':
      if (isStaff(ctx)) return doc;
      if (ctx.level === 'tw') return strip(doc, ['farmer', 'phone', 'log']);               // BRD BR-03: Cấp TW không thấy họ tên, SĐT nông hộ
      return null;
    case 'bgLog': case 'bgLock': case 'bgSyn': return isStaff(ctx) ? doc : null;
    case 'prCat': case 'prRep': return isStaff(ctx) ? doc : null;                          // Chương trình khuyến nông (báo cáo tuần của Phòng TTTT): chỉ Cấp Tỉnh / Admin
    default: return null;
  }
}

/* ------------------------------------------------------------------ GHI ------------------------------------------------------------------ */
/** So sánh không phụ thuộc thứ tự khóa (JSONB của PostgreSQL sắp xếp lại khóa, trình duyệt thì giữ thứ tự riêng) */
const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',')}}` : JSON.stringify(v === undefined ? null : v));
const same = (a, b) => canon(a) === canon(b);
const keysChanged = (o, n, ignore = ['log']) => { const ks = new Set([...Object.keys(o || {}), ...Object.keys(n || {})]); return [...ks].filter((k) => !ignore.includes(k) && !same((o || {})[k], (n || {})[k])); };
const xaRec = async (id) => { const r = await docs.get('bgXa', id); return r ? r.doc : null; };
const canActXa = async (ctx, xaId) => { if (ctx.isAdmin) return true; const x = await xaRec(xaId); return !!x && (!x.tinh || x.tinh === ctx.user.id); };
const boardApproved = async (date) => { const b = await docs.get('bgBoard', 'bd|' + date); return !!b && b.doc.st === 'approved'; };
const num = (v) => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1e9;

function validItems(items) {
  if (!items || typeof items !== 'object') return 'Phiếu thiếu danh sách mặt hàng.';
  for (const k of Object.keys(items)) {
    const e = items[k]; if (!e || typeof e !== 'object') return 'Dòng giá không hợp lệ.';
    if (e.none || e.removed) continue;
    if (e.lo == null && e.hi == null) continue;                       // dòng còn trống (bản nháp)
    if (!num(e.lo) || !num(e.hi)) return 'Giá phải là số không âm, hợp lý.';
    if (e.lo > e.hi) return 'Giá thấp nhất không được lớn hơn giá cao nhất.';
    if (e.adj && (!num(e.adj.lo) || !num(e.adj.hi) || e.adj.lo > e.adj.hi)) return 'Giá hiệu chỉnh không hợp lệ.';
  }
  return null;
}
/** Cấp Xã không được tự đặt hoặc đổi giá hiệu chỉnh / dòng bị loại: hai trường này chỉ Cấp Tỉnh được ghi */
function xaTouchedStaffFields(old, nu) {
  const keys = new Set([...Object.keys((old || {}).items || {}), ...Object.keys(nu.items || {})]);
  for (const k of keys) { const o = ((old || {}).items || {})[k] || {}; const n = (nu.items || {})[k] || {}; if (!same(o.adj, n.adj) || !same(o.removed, n.removed)) return true; }
  return false;
}

const DENY = (m) => m;

/** Kiểm tra một thao tác ghi. Trả về null nếu được phép, hoặc chuỗi lý do từ chối */
async function checkWrite(ctx, c, op, old, nu) {
  if (!ctx.level) return 'Chưa chọn vai trò làm việc.';
  if (!SYNCED.has(c)) return `Không có quyền ghi vào "${c}".`;
  if (op === 'put' && (!nu || nu.id == null)) return 'Bản ghi thiếu mã.';
  const staff = ctx.level === 'tinh'; const xa = ctx.level === 'xa';
  const op_ = OPERATIONAL.includes(c);
  if (op_ && ctx.dept !== 'tttt') return 'Dữ liệu Báo giá chỉ thao tác trong phòng Thông tin tuyên truyền.';

  switch (c) {
    case 'xa': case 'depts': case 'users': case 'bgXa': case 'bgSys':
      return ctx.isAdmin ? null : DENY('Chỉ Admin được thay đổi dữ liệu này.');
    case 'bgCfg': case 'bgItem': case 'bgGroup': case 'bgSet':
      return ctx.qtnv ? null : DENY('Chỉ cán bộ Quản trị nghiệp vụ (hoặc Admin) được thay đổi danh mục và cấu hình báo giá.');
    case 'notifs':
      if (op === 'put') { if (!(await docs.get('users', nu.to))) return 'Người nhận thông báo không tồn tại.'; if (old && (old.to !== ctx.user.id || nu.to !== old.to)) return 'Chỉ người nhận được cập nhật thông báo của mình.'; return null; }
      return old && old.to === ctx.user.id ? null : DENY('Chỉ người nhận được xóa thông báo của mình.');
    case 'bgRemind': return DENY('Nhắc nhập giá do hệ thống tự sinh.');
    case 'bgProp':
      if (xa) { if (op === 'put' && !old && ctx.xaIds.includes(nu.xa) && nu.st === 'pending') return null; return DENY('Cấp Xã chỉ được gửi đề xuất mới cho xã của mình.'); }
      return ctx.qtnv ? null : DENY('Chỉ cán bộ Quản trị nghiệp vụ duyệt đề xuất mặt hàng.');
    case 'bgLog':   // nhật ký thao tác của ngày: mọi vai trò được GHI THÊM (thao tác của chính mình), không ai sửa hoặc xóa
      return op === 'put' && !old && typeof nu.text === 'string' ? null : DENY('Nhật ký thao tác chỉ được ghi thêm, không sửa hoặc xóa.');
    case 'bgSyn':
      return staff || ctx.isAdmin ? null : DENY('Chỉ Cấp Tỉnh / Admin.');
    case 'bgLock':
      if (!staff) return DENY('Chỉ Cấp Tỉnh dùng khóa sửa / duyệt.');
      if (op === 'put') return nu.user === ctx.user.id ? null : DENY('Chỉ được tạo khóa cho chính mình.');
      return null;
    case 'bgRound': case 'bgSrv':
      return staff || ctx.isAdmin ? null : DENY('Chỉ Cấp Tỉnh / Admin quản lý điều tra giá thành.');
    case 'bgBoard': {
      if (!staff) return DENY('Chỉ Cấp Tỉnh duyệt và công bố bảng giá.');
      if (nu && nu.st === 'approved' && (!old || old.st !== 'approved' || nu.ver !== old.ver)) {     // thao tác duyệt
        if (!(await D.locked(nu.date))) return DENY('Chưa qua giờ khóa nhập, chưa duyệt được bảng giá.');
        const open = await query("SELECT COUNT(*)::int AS n FROM docs WHERE c = 'bgAlert' AND json->>'date' = $1 AND json->>'st' <> 'huy' AND json->>'st' NOT IN ('dahc', 'giu', 'loai')", [nu.date]);
        if (open.rows[0].n) return DENY(`Còn ${open.rows[0].n} cảnh báo chưa xử lý, chưa duyệt được bảng giá.`);
        const ph = await query("SELECT 1 FROM docs WHERE c = 'bgPhieu' AND json->>'date' = $1 AND json->>'st' IN ('sent', 'late') LIMIT 1", [nu.date]);
        if (!ph.rowCount) return DENY('Ngày này không có phiếu nào để công bố.');
      }
      return null;
    }
    case 'prCat': case 'prRep': return checkProg(ctx, c, op, old, nu);
    case 'bgPhieu': return checkPhieu(ctx, op, old, nu);
    case 'bgAlert': return checkAlert(ctx, op, old, nu);
    default: return DENY('Không có quyền.');
  }
}

/** Chương trình khuyến nông (Chương trình thông tin; Đào tạo huấn luyện và hợp tác): chỉ Cấp Tỉnh / Admin; báo cáo tuần đã chốt không sửa được; số liệu là số không âm */
async function checkProg(ctx, c, op, old, nu) {
  if (!(ctx.level === 'tinh' || ctx.isAdmin)) return DENY('Chỉ Cấp Tỉnh / Admin quản lý Chương trình khuyến nông.');
  const okNum = (v) => typeof v === 'number' && isFinite(v) && v >= 0 && v <= 1e13;
  if (c === 'prRep') {
    if (op === 'del') return DENY('Không xóa báo cáo tuần.');
    if (old && old.st === 'sent' && keysChanged(old, nu).length) return DENY('Báo cáo tuần đã chốt, không sửa được.');
    if (old && (old.prog !== nu.prog || old.week !== nu.week)) return DENY('Không đổi chương trình hoặc tuần của báo cáo.');
    if (!old && nu.st !== 'draft') return DENY('Báo cáo tuần mới phải ở trạng thái bản nháp.');
    if (!['tt', 'dt'].includes(nu.prog) || !Number.isInteger(nu.week)) return DENY('Báo cáo thiếu chương trình hoặc tuần.');
    for (const o of Object.values(nu.rows || {})) {
      if (!o || typeof o !== 'object') return DENY('Dòng số liệu không hợp lệ.');
      for (const f of ['t', 'k', 'kl']) if (o[f] != null && o[f] !== '' && !okNum(o[f])) return DENY('Tiến độ và kinh phí phải là số không âm.');
    }
    return null;
  }
  if (!old || op === 'del') {     // thêm hoặc xóa hạng mục (kể cả hạng mục có sẵn trong biểu mẫu): chỉ khi chương trình còn báo cáo tuần ở trạng thái nháp (báo cáo đã chốt thì đóng băng)
    const dr = await query("SELECT 1 FROM docs WHERE c = 'prRep' AND json->>'prog' = $1 AND json->>'st' = 'draft' LIMIT 1", [(nu || old).prog]);
    if (!dr.rowCount) return DENY('Báo cáo tuần đã chốt, không thêm hoặc xóa hạng mục được. Tạo báo cáo tuần mới trước.');
  }
  if (op === 'del') return null;
  if (!['tt', 'dt'].includes(nu.prog) || typeof nu.ten !== 'string' || !nu.ten.trim()) return DENY('Hạng mục thiếu chương trình hoặc tên.');
  for (const f of ['quyMo', 'kh']) if (nu[f] != null && !(typeof nu[f] === 'number' && isFinite(nu[f]) && nu[f] > 0)) return DENY('Quy mô phải lớn hơn 0.');
  return null;
}

async function checkPhieu(ctx, op, old, nu) {
  if (ctx.isAdmin) return DENY('Admin không nhập hay sửa báo giá khi vận hành.');
  if (ctx.level === 'tw') return DENY('Cấp TW chỉ được xem.');
  if (ctx.level === 'xa') {
    if (op === 'del') return DENY('Cấp Xã không được xóa phiếu.');
    if (!ctx.xaIds.includes(nu.xa)) return DENY('Không được nhập báo giá cho xã khác.');
    if (old && (old.xa !== nu.xa || old.date !== nu.date)) return DENY('Không được đổi xã hoặc ngày của phiếu.');
    if (!['draft', 'sent'].includes(nu.st)) return DENY('Cấp Xã chỉ lưu nháp hoặc gửi phiếu.');
    if (old && !['draft', 'sent'].includes(old.st)) return DENY('Phiếu này đã khóa, Cấp Xã không sửa được.');
    if (!(await D.isDay(nu.date))) return DENY('Ngày này không phải ngày báo giá.');
    if (await D.locked(nu.date)) return DENY(`Đã quá giờ khóa nhập ${(await D.cfg()).lock}, không nhập hoặc sửa được nữa.`);
    if (xaTouchedStaffFields(old, nu)) return DENY('Cấp Xã không được hiệu chỉnh hay loại dòng giá.');
    return validItems(nu.items);
  }
  // Cấp Tỉnh: chỉ với xã mình phụ trách (hoặc xã chưa phân công); không sửa khi bảng giá đã duyệt (trừ ghi nhật ký)
  const xaId = (nu || old).xa; const date = (nu || old).date;
  if (old && nu && op === 'put' && keysChanged(old, nu).length === 0) return null;      // chỉ ghi thêm nhật ký của phiếu (ví dụ khi duyệt bảng giá gắn nhãn "thuộc bảng giá vN" cho phiếu của mọi xã)
  if (!(await canActXa(ctx, xaId))) return DENY('Xã này thuộc phân công của cán bộ Tỉnh khác.');
  if (old && nu && op === 'put' && old.xa !== nu.xa) return DENY('Không đổi xã của phiếu.');
  if (await boardApproved(date)) return DENY('Bảng giá ngày này đã duyệt. Cần mở duyệt trước khi sửa.');
  return op === 'put' ? validItems(nu.items) : null;
}

async function checkAlert(ctx, op, old, nu) {
  if (ctx.isAdmin) return DENY('Admin không xử lý cảnh báo khi vận hành.');
  if (ctx.level === 'tw') return DENY('Cấp TW chỉ được xem.');
  if (op === 'del') return DENY('Không xóa cảnh báo.');
  if (ctx.level === 'xa') {
    if (!ctx.xaIds.includes(nu.xa)) return DENY('Không được thao tác cảnh báo của xã khác.');
    if (!old) return nu.st === 'tam' && !nu.req && !nu.reply && !nu.res ? null : DENY('Cảnh báo mới chỉ được sinh ở trạng thái Tạm tính.');
    if (old.xa !== nu.xa || old.date !== nu.date || old.item !== nu.item) return DENY('Không đổi xã, ngày, mặt hàng của cảnh báo.');
    const ch = keysChanged(old, nu);
    if (!ch.length) return null;
    // (1) Phản hồi yêu cầu xác minh: chỉ gửi trước hạn phản hồi (đồng hồ máy chủ); chỉ ghi reply và chuyển yc → ph
    if (old.st === 'yc' && ch.every((k) => k === 'reply' || k === 'st') && nu.st === 'ph' && nu.reply) {
      if (old.req && old.req.deadline && (await D.clock()) > old.req.deadline) return DENY(`Đã quá hạn phản hồi (${old.req.deadline.slice(11)}), không gửi phản hồi được nữa.`);
      return null;
    }
    // (2) Gửi lại phiếu trước giờ khóa: cập nhật số liệu của cảnh báo chưa xử lý, hoặc tự hủy khi giá về dưới ngưỡng (cả khi đang yêu cầu xác minh)
    if (['tam', 'cho', 'yc', 'ph'].includes(old.st)) {
      const okKeys = ch.every((k) => ['p', 'ref', 'pct', 'kind', 'xaNote', 'st'].includes(k));
      if (okKeys && (nu.st === old.st || nu.st === 'huy') && same(nu.req, old.req) && same(nu.reply, old.reply) && same(nu.res, old.res)) {
        if (await D.locked(old.date)) return DENY('Đã quá giờ khóa nhập, Cấp Xã không cập nhật cảnh báo được nữa.');
        return null;
      }
    }
    return DENY('Cấp Xã chỉ được gửi phản hồi xác minh hoặc cập nhật theo lần gửi lại phiếu.');
  }
  // Cấp Tỉnh
  const xaId = (nu || old).xa; if (!(await canActXa(ctx, xaId))) return DENY('Xã này thuộc phân công của cán bộ Tỉnh khác.');
  if (old && (old.xa !== nu.xa || old.date !== nu.date || old.item !== nu.item)) return DENY('Không đổi xã, ngày, mặt hàng của cảnh báo.');
  if (old && keysChanged(old, nu).length && (await boardApproved(old.date))) return DENY('Bảng giá ngày này đã duyệt. Cần mở duyệt trước khi xử lý cảnh báo.');
  return null;
}

module.exports = { makeCtx, readScope, checkWrite, SYNCED, OPERATIONAL, isStaff };
