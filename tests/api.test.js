'use strict';
/* Kiểm thử API: đăng nhập, phạm vi dữ liệu theo vai trò, quy tắc ghi (khóa giờ, phiên bản, quyền theo trường).
   Chạy:  node --test tests/        (dùng cơ sở dữ liệu tạm, không đụng dữ liệu thật) */
const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-test-'));
process.env.BG_OUTBOX_DIR = tmp;
const createTestDb = require('./testdb');

let base; let srv; let tdb;
test.before(async () => { tdb = await createTestDb('api'); const { start } = require('../server/server'); const r = await start(0, '127.0.0.1'); srv = r; base = `http://127.0.0.1:${r.port}`; });
test.after(async () => { clearInterval(srv.timer); await new Promise((res) => srv.server.close(res)); await tdb.drop(); });

/** Khách HTTP nhỏ có cookie */
function client(role) {
  let sid = '';
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bg', Cookie: sid ? `bg_sid=${sid}` : '', ...(role ? { 'X-Role': role } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) { const m = /bg_sid=([^;]*)/.exec(sc); if (m) sid = m[1]; }
    let j = null; try { j = await r.json(); } catch (e) { /* không phải JSON */ }
    return { status: r.status, body: j };
  };
  return { call, login: (u, pw) => call('POST', '/api/login', { u, pw: pw || 'nongnghiep2026' }), setRole: (x) => { role = x; } };
}
const put = (c, doc, base) => ({ c, id: doc.id, op: 'put', base: base || 0, doc });

test('chưa đăng nhập thì không đọc được dữ liệu (401)', async () => {
  const c = client('0|tttt'); const r = await c.call('GET', '/api/state'); assert.strictEqual(r.status, 401);
});

test('sai mật khẩu báo còn mấy lần thử, sai 5 lần thì khóa tạm (423)', async () => {
  const c = client(); const r1 = await c.login('ho.huu.thuy.chauphu', 'sai'); assert.strictEqual(r1.status, 401); assert.strictEqual(r1.body.left, 4);
  for (let i = 0; i < 3; i++) await c.login('ho.huu.thuy.chauphu', 'sai');
  const r5 = await c.login('ho.huu.thuy.chauphu', 'sai'); assert.strictEqual(r5.status, 423);
  const ok = await c.login('ho.huu.thuy.chauphu'); assert.strictEqual(ok.status, 423, 'đang khóa thì mật khẩu đúng cũng không vào được');
});

test('đăng nhập bằng tên đăng nhập, email, số điện thoại', async () => {
  for (const key of ['an.nv.myhoahung', 'an.nv@khuyennong.angiang.gov.vn', '0912345678']) { const c = client(); const r = await c.login(key); assert.strictEqual(r.status, 200, key); assert.strictEqual(r.body.user.pw, undefined, 'không lộ mật khẩu'); }
});

test('Cấp Xã chỉ thấy phiếu / cảnh báo của xã mình, không thấy mật khẩu', async () => {
  const c = client('0|tttt'); await c.login('0912345678');
  const s = (await c.call('GET', '/api/state')).body;
  assert.ok(s.db.bgPhieu.length > 0); assert.ok(s.db.bgPhieu.every((p) => p.xa === 'bx01'), 'chỉ xã bx01');
  assert.ok(s.db.bgAlert.every((a) => a.xa === 'bx01'));
  assert.ok(s.db.users.every((u) => u.pw === undefined), 'users không có pw');
  assert.strictEqual(s.db.bgSrv.length, 0, 'Cấp Xã không thấy phiếu điều tra giá thành');
  assert.ok(s.db.notifs.every((n) => n.to === 'u_an'), 'chỉ thông báo của mình');
});

test('Cấp TW không thấy họ tên, SĐT nông hộ trong phiếu điều tra (BRD BR-03)', async () => {
  const c = client('0|tttt'); await c.login('quan.lm.tw'); const s = (await c.call('GET', '/api/state')).body;
  assert.ok(s.db.bgSrv.length > 0, 'vẫn có số liệu để tính báo cáo giá thành');
  assert.ok(s.db.bgSrv.every((r) => r.farmer === undefined && r.phone === undefined), 'đã bỏ farmer, phone');
  assert.strictEqual(s.db.bgPhieu.length, 0, 'Cấp TW không thấy phiếu từng xã');
  assert.ok(s.db.bgBoard.length > 0, 'nhưng xem được bảng giá đã công bố');
});

test('Cấp Xã không ghi được phiếu của xã khác (403 từ chối)', async () => {
  const c = client('0|tttt'); await c.login('0912345678');
  const r = await c.call('POST', '/api/sync', { ops: [put('bgPhieu', { id: 'ph|bx02|2026-10-15', xa: 'bx02', date: '2026-10-15', items: {}, st: 'draft' })] });
  assert.strictEqual(r.body.results[0].ok, false); assert.strictEqual(r.body.results[0].code, 'forbidden');
});

test('Cấp Xã gửi phiếu trước giờ khóa được, sau giờ khóa bị từ chối theo ĐỒNG HỒ MÁY CHỦ', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678');
  const st = (await xa.call('GET', '/api/state')).body;
  const cur = st.db.bgPhieu.find((p) => p.date === '2026-10-15'); const ver = st.vers.bgPhieu[cur.id];
  const edit = { ...cur, items: { ...cur.items, jasmine: { ...cur.items.jasmine, lo: 8600, hi: 9000 } } };
  const r = await xa.call('POST', '/api/sync', { ops: [put('bgPhieu', edit, ver)] });
  assert.strictEqual(r.body.results[0].ok, true, JSON.stringify(r.body.results[0]));
  // Admin đổi đồng hồ hệ thống sang 12:01 (qua giờ khóa 12:00)
  const ad = client('0|tttt'); await ad.login('admin');
  const adSt = (await ad.call('GET', '/api/state')).body; const sysDoc = adSt.db.bgSys[0];
  const r2 = await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...sysDoc, clock: '2026-10-15T12:01' }, adSt.vers.bgSys.sys)] });
  assert.strictEqual(r2.body.results[0].ok, true);
  const again = await xa.call('POST', '/api/sync', { ops: [put('bgPhieu', { ...edit, items: { ...edit.items, jasmine: { ...edit.items.jasmine, lo: 8700 } } }, r.body.results[0].ver)] });
  assert.strictEqual(again.body.results[0].code, 'forbidden'); assert.match(again.body.results[0].msg, /giờ khóa/);
  // trả đồng hồ về
  const cur2 = (await ad.call('GET', '/api/state')).body;
  await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...sysDoc, clock: '2026-10-15T09:15' }, cur2.vers.bgSys.sys)] });
});

test('Cấp Xã không sửa được kết luận xử lý (res) của cảnh báo, chỉ được phản hồi', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678'); const s = (await xa.call('GET', '/api/state')).body;
  const al = s.db.bgAlert.find((a) => a.st === 'yc'); assert.ok(al, 'có cảnh báo đang yêu cầu xác minh');
  const bad = await xa.call('POST', '/api/sync', { ops: [put('bgAlert', { ...al, res: { type: 'giu', note: 'tự giữ nguyên' }, st: 'giu' }, s.vers.bgAlert[al.id])] });
  assert.strictEqual(bad.body.results[0].code, 'forbidden');
  const good = await xa.call('POST', '/api/sync', { ops: [put('bgAlert', { ...al, reply: { kind: 'giu', text: 'Đã kiểm tra lại với thương lái', at: '2026-10-15T09:20', by: 'u_an' }, st: 'ph' }, s.vers.bgAlert[al.id])] });
  assert.strictEqual(good.body.results[0].ok, true, JSON.stringify(good.body.results[0]));
});

test('ghi trên phiên bản cũ thì báo xung đột và trả bản mới của máy chủ', async () => {
  const t = client('0|tttt'); await t.login('binh.tt.tinh'); const s = (await t.call('GET', '/api/state')).body;
  const item = s.db.bgItem[0]; const v = s.vers.bgItem[item.id];
  const a = await t.call('POST', '/api/sync', { ops: [put('bgItem', { ...item, ten: item.ten + ' (sửa 1)' }, v)] }); assert.strictEqual(a.body.results[0].ok, true);
  const b = await t.call('POST', '/api/sync', { ops: [put('bgItem', { ...item, ten: item.ten + ' (sửa 2)' }, v)] });
  assert.strictEqual(b.body.results[0].code, 'conflict'); assert.strictEqual(b.body.results[0].doc.ten, item.ten + ' (sửa 1)');
});

test('Cấp Xã không sửa được danh mục mặt hàng; Admin không nhập báo giá', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678'); const s = (await xa.call('GET', '/api/state')).body; const it = s.db.bgItem[1];
  const r = await xa.call('POST', '/api/sync', { ops: [put('bgItem', { ...it, ten: 'Hack' }, s.vers.bgItem[it.id])] }); assert.strictEqual(r.body.results[0].code, 'forbidden');
  const ad = client('0|tttt'); await ad.login('admin');
  const r2 = await ad.call('POST', '/api/sync', { ops: [put('bgPhieu', { id: 'ph|bx01|2026-10-15', xa: 'bx01', date: '2026-10-15', items: {}, st: 'draft' }, 1)] });
  assert.strictEqual(r2.body.results[0].code, 'forbidden');
});

test('thay đổi của người khác được trả về qua /api/changes theo vai trò', async () => {
  const t = client('0|tttt'); await t.login('binh.tt.tinh'); const s = (await t.call('GET', '/api/state')).body;
  const xa = client('0|tttt'); await xa.login('0912345678'); const cur = (await xa.call('GET', '/api/state')).body.cursor;
  const g = s.db.bgGroup[0]; await t.call('POST', '/api/sync', { ops: [put('bgGroup', { ...g, ten: g.ten + '!' }, s.vers.bgGroup[g.id])] });
  const ch = (await xa.call('GET', `/api/changes?since=${cur}`)).body;
  assert.ok(ch.put.some((x) => x.c === 'bgGroup' && x.doc.ten === g.ten + '!'), 'Cấp Xã nhận được thay đổi danh mục');
  assert.ok(ch.cursor > cur);
});

test('đổi mật khẩu cần mật khẩu cũ và luật độ mạnh; đăng xuất hủy phiên', async () => {
  const c = client('0|tttt'); await c.login('lam.minh.linh.anchau');
  assert.strictEqual((await c.call('POST', '/api/password', { old: 'sai', pw: 'Matkhau123' })).status, 400);
  assert.strictEqual((await c.call('POST', '/api/password', { old: 'nongnghiep2026', pw: 'abc' })).status, 400);
  assert.strictEqual((await c.call('POST', '/api/password', { old: 'nongnghiep2026', pw: 'Matkhau123' })).status, 200);
  await c.call('POST', '/api/logout'); assert.strictEqual((await c.call('GET', '/api/me')).status, 401);
  assert.strictEqual((await client().login('lam.minh.linh.anchau', 'Matkhau123')).status, 200);
});

test('quên mật khẩu: link dùng một lần, mật khẩu mới có hiệu lực', async () => {
  const c = client(); const r = await c.call('POST', '/api/forgot', { email: 'binh.tt@khuyennong.angiang.gov.vn' }); assert.strictEqual(r.status, 200);
  const log = fs.readFileSync(path.join(tmp, 'outbox.log'), 'utf8'); const token = /#\/reset\/([a-f0-9]+)/.exec(log)[1];
  assert.strictEqual((await c.call('POST', '/api/reset', { token, pw: 'MatKhauMoi2026' })).status, 200);
  assert.strictEqual((await c.call('POST', '/api/reset', { token, pw: 'MatKhauMoi2027' })).status, 400, 'dùng lần hai bị từ chối');
  assert.strictEqual((await client().login('binh.tt.tinh', 'MatKhauMoi2026')).status, 200);
});

test('nhắc nhập giá sinh một lần duy nhất dù chạy lại nhiều lần', async () => {
  const ad = client('0|tttt'); await ad.login('admin'); const s = (await ad.call('GET', '/api/state')).body;
  await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...s.db.bgSys[0], clock: '2026-10-16T10:40' }, s.vers.bgSys.sys)] });   // thứ Sáu, sau 07:30 và 10:30
  const tk = require('../server/ticker'); const n1 = await tk.reminders(); const n2 = await tk.reminders();
  assert.ok(n1 > 0, 'có sinh nhắc'); assert.strictEqual(n2, 0, 'chạy lại không sinh trùng');
  const s2 = (await ad.call('GET', '/api/state')).body; await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...s2.db.bgSys[0], clock: '2026-10-15T09:15' }, s2.vers.bgSys.sys)] });   // trả đồng hồ về mốc dữ liệu mẫu
});

test('Admin tạo tài khoản mới (mật khẩu được băm, buộc đổi lần đầu); Cấp Xã không tạo được', async () => {
  const ad = client('0|tttt'); await ad.login('admin'); const s = (await ad.call('GET', '/api/state')).body;
  const nu = { id: 'u_new1', ten: 'Cán bộ mới', username: 'moi.nv', email: 'moi@khuyennong.demo', phone: '0933000111', pw: 'KhoiTao2026', active: true, roles: [{ level: 'xa', depts: ['tttt'], bgXa: ['bx04'] }] };
  const r = await ad.call('POST', '/api/sync', { ops: [put('users', nu)] }); assert.strictEqual(r.body.results[0].ok, true, JSON.stringify(r.body.results[0]));
  const st2 = (await ad.call('GET', '/api/state')).body; const saved = st2.db.users.find((u) => u.id === 'u_new1'); assert.ok(saved && saved.pw === undefined && saved.mustChange === true);
  assert.strictEqual((await client().login('moi.nv', 'KhoiTao2026')).status, 200, 'người mới đăng nhập được bằng mật khẩu khởi tạo');
  const xa = client('0|tttt'); await xa.login('0912345678');
  const bad = await xa.call('POST', '/api/sync', { ops: [put('users', { ...nu, id: 'u_new2', username: 'hack', pw: 'Hack2026x' })] }); assert.strictEqual(bad.body.results[0].code, 'forbidden');
  assert.strictEqual((await client().login('hack', 'Hack2026x')).status, 401, 'mật khẩu không bị đặt khi bị từ chối');
  const victim = await xa.call('POST', '/api/sync', { ops: [put('users', { id: 'u_khoa', ten: 'x', pw: 'Chiem2026x', roles: [], active: true }, 1)] }); assert.strictEqual(victim.body.results[0].code, 'forbidden');
  assert.strictEqual((await client().login('khoa.pm.tinh', 'Chiem2026x')).status, 401, 'không đổi được mật khẩu người khác');
});

test('Cấp Xã không ghi được phiếu điều tra, đợt điều tra, bảng giá đã duyệt; Cấp Tỉnh không ghi vào dữ liệu của Admin', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678'); const t = client('0|tttt'); await t.login('khoa.pm.tinh'); const s = (await t.call('GET', '/api/state')).body;
  const srv = s.db.bgSrv[0]; const r = await xa.call('POST', '/api/sync', { ops: [put('bgSrv', { ...srv, price: 1 }, 1), put('bgBoard', { ...s.db.bgBoard[0], st: 'approved' }, 1)] });
  assert.deepStrictEqual(r.body.results.map((x) => x.code), ['forbidden', 'forbidden']);
  const cfg = s.db.bgCfg[0]; const r2 = await t.call('POST', '/api/sync', { ops: [put('bgXa', { ...s.db.bgXa[0], ten: 'Đổi tên' }, s.vers.bgXa[s.db.bgXa[0].id]), put('bgCfg', { ...cfg, lock: '23:00' }, s.vers.bgCfg.cfg)] });
  assert.deepStrictEqual(r2.body.results.map((x) => x.code), ['forbidden', 'forbidden'], 'Cấp Tỉnh thường không phải Quản trị nghiệp vụ nên không đổi giờ khóa');
});

test('thông báo gửi cho người khác được ghi, nhưng người khác đọc không thấy; chỉ người nhận đánh dấu đã đọc', async () => {
  const t = client('0|tttt'); await t.login('khoa.pm.tinh'); const xa = client('0|tttt'); await xa.login('0912345678');
  const n = { id: 'nt_test1', to: 'u_an', title: 'Kiểm thử', body: 'Nội dung', dept: 'tttt', level: 'xa', kind: 'info', at: '2026-10-15T09:30', read: false };
  assert.strictEqual((await t.call('POST', '/api/sync', { ops: [put('notifs', n)] })).body.results[0].ok, true);
  const mine = (await xa.call('GET', '/api/state')).body.db.notifs.find((x) => x.id === 'nt_test1'); assert.ok(mine, 'người nhận thấy');
  const tinhSees = (await t.call('GET', '/api/state')).body.db.notifs.find((x) => x.id === 'nt_test1'); assert.ok(!tinhSees, 'người gửi không đọc lại được thông báo của người khác');
  const tamper = await t.call('POST', '/api/sync', { ops: [put('notifs', { ...n, read: true }, 1)] }); assert.strictEqual(tamper.body.results[0].code, 'forbidden');
  const st = (await xa.call('GET', '/api/state')).body; const rd = await xa.call('POST', '/api/sync', { ops: [put('notifs', { ...n, read: true }, st.vers.notifs.nt_test1)] }); assert.strictEqual(rd.body.results[0].ok, true);
});

test('yêu cầu không có X-Requested-With bị chặn (CSRF); không đọc được tệp ngoài thư mục giao diện', async () => {
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ u: 'admin', pw: 'x' }) }); assert.strictEqual(r.status, 403);
  const t1 = await fetch(base + '/..%2f..%2fserver%2fdb.js'); assert.ok([403, 404].includes(t1.status)); const txt = await t1.text(); assert.ok(!txt.includes('DatabaseSync'));
});

test('nhật ký thao tác chỉ ghi thêm: Cấp Xã ghi được dòng mới, không sửa hay xóa được', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678');
  const row = { id: 'bl_test1', date: '2026-10-15', at: '2026-10-15T09:15', by: 'Nguyễn Văn An', text: 'Kiểm thử ghi nhật ký', ref: null };
  assert.strictEqual((await xa.call('POST', '/api/sync', { ops: [put('bgLog', row)] })).body.results[0].ok, true);
  assert.strictEqual((await xa.call('POST', '/api/sync', { ops: [put('bgLog', { ...row, text: 'đã sửa' }, 1)] })).body.results[0].code, 'forbidden');
  assert.strictEqual((await xa.call('POST', '/api/sync', { ops: [{ c: 'bgLog', id: 'bl_test1', op: 'del', base: 1 }] })).body.results[0].code, 'forbidden');
  const tw = client('0|tttt'); await tw.login('quan.lm.tw'); assert.strictEqual((await tw.call('GET', '/api/state')).body.db.bgLog.length, 0, 'Cấp TW không đọc nhật ký');
});

test('máy chủ chặn duyệt bảng giá khi chưa qua giờ khóa, còn cảnh báo chưa xử lý; Admin và Cấp Xã không duyệt được', async () => {
  const t = client('0|tttt'); await t.login('khoa.pm.tinh'); const ad = client('0|tttt'); await ad.login('admin');
  { const z = (await ad.call('GET', '/api/state')).body; await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...z.db.bgSys[0], clock: '2026-10-15T09:15' }, z.vers.bgSys.sys)] }); }
  const s = (await t.call('GET', '/api/state')).body; const b = s.db.bgBoard.find((x) => x.date === '2026-10-15'); const approve = { ...b, st: 'approved', ver: (b.ver || 0) + 1 };
  const early = await t.call('POST', '/api/sync', { ops: [put('bgBoard', approve, s.vers.bgBoard[b.id])] });
  assert.strictEqual(early.body.results[0].code, 'forbidden'); assert.match(early.body.results[0].msg, /giờ khóa/);
  const as = (await ad.call('GET', '/api/state')).body;
  await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...as.db.bgSys[0], clock: '2026-10-15T12:30' }, as.vers.bgSys.sys)] });
  const open = await t.call('POST', '/api/sync', { ops: [put('bgBoard', approve, s.vers.bgBoard[b.id])] });
  assert.strictEqual(open.body.results[0].code, 'forbidden'); assert.match(open.body.results[0].msg, /cảnh báo chưa xử lý/);
  const adm = await ad.call('POST', '/api/sync', { ops: [put('bgBoard', approve, as.vers.bgBoard[b.id])] }); assert.strictEqual(adm.body.results[0].code, 'forbidden');
  const xa = client('0|tttt'); await xa.login('0912345678'); const xs = (await xa.call('GET', '/api/state')).body;
  assert.strictEqual((await xa.call('POST', '/api/sync', { ops: [put('bgBoard', approve, xs.vers.bgBoard[b.id])] })).body.results[0].code, 'forbidden');
  const cur = (await ad.call('GET', '/api/state')).body; await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...as.db.bgSys[0], clock: '2026-10-15T09:15' }, cur.vers.bgSys.sys)] });
});

test('phản hồi xác minh quá hạn 13:30 bị máy chủ từ chối; trước hạn (kể cả sau giờ khóa 12:00) được chấp nhận', async () => {
  const xa = client('0|tttt'); await xa.login('0912345678'); const ad = client('0|tttt'); await ad.login('admin');
  const setClock = async (clock) => { const a = (await ad.call('GET', '/api/state')).body; await ad.call('POST', '/api/sync', { ops: [put('bgSys', { ...a.db.bgSys[0], clock }, a.vers.bgSys.sys)] }); };
  const st = (await xa.call('GET', '/api/state')).body; const ycs = st.db.bgAlert.filter((a) => a.st === 'yc'); assert.ok(ycs.length >= 1);
  const rep = (a) => ({ ...a, reply: { kind: 'giu', text: 'Giữ giá', at: '2026-10-15T12:30', by: 'u_an' }, st: 'ph' });
  await setClock('2026-10-15T13:45'); assert.strictEqual((await xa.call('POST', '/api/sync', { ops: [put('bgAlert', rep(ycs[0]), st.vers.bgAlert[ycs[0].id])] })).body.results[0].code, 'forbidden');
  await setClock('2026-10-15T12:30'); const okRes = (await xa.call('POST', '/api/sync', { ops: [put('bgAlert', rep(ycs[0]), st.vers.bgAlert[ycs[0].id])] })).body.results[0]; assert.strictEqual(okRes.ok, true, JSON.stringify(okRes));
  await setClock('2026-10-15T09:15');
});

test('Chương trình khuyến nông: chỉ Cấp Tỉnh / Admin đọc và ghi; Cấp Xã và Cấp TW không thấy, không ghi', async () => {
  const tinh = client('0|tttt'); await tinh.login('khoa.pm.tinh'); const xa = client('0|tttt'); await xa.login('0912345678'); const tw = client('0|tttt'); await tw.login('quan.lm.tw'); const ad = client('0|tttt'); await ad.login('admin');
  const st = (await tinh.call('GET', '/api/state')).body; assert.strictEqual(st.db.prCat.length, 25, '19 + 6 hạng mục'); assert.strictEqual(st.db.prRep.length, 4, '2 chương trình × 2 tuần');
  for (const who of [xa, tw]) { const s = (await who.call('GET', '/api/state')).body; assert.ok(!(s.db.prCat || []).length && !(s.db.prRep || []).length, 'không nhận dữ liệu chương trình'); }
  const draft = st.db.prRep.find((r) => r.id === 'dt|44'); assert.strictEqual(draft.st, 'draft');
  const edit = { ...draft, rows: { dt04: { t: 2, k: 40000000, kl: 250000000, d: 'Đã mở lớp' } } };
  for (const who of [xa, tw]) assert.strictEqual((await who.call('POST', '/api/sync', { ops: [put('prRep', edit, st.vers.prRep['dt|44'])] })).body.results[0].code, 'forbidden');
  const ok = (await tinh.call('POST', '/api/sync', { ops: [put('prRep', edit, st.vers.prRep['dt|44'])] })).body.results[0]; assert.strictEqual(ok.ok, true, JSON.stringify(ok));
  const sa = (await ad.call('GET', '/api/state')).body; const okAd = (await ad.call('POST', '/api/sync', { ops: [put('prRep', { ...sa.db.prRep.find((r) => r.id === 'dt|44'), rows: { dt04: { t: 3, k: 1, d: '' } } }, sa.vers.prRep['dt|44'])] })).body.results[0]; assert.strictEqual(okAd.ok, true, 'Admin (phòng TTTT) ghi được: ' + JSON.stringify(okAd));
});

test('Chương trình khuyến nông: số âm hoặc không phải số bị từ chối; báo cáo đã chốt không sửa, không xóa', async () => {
  const tinh = client('0|tttt'); await tinh.login('khoa.pm.tinh'); const st = (await tinh.call('GET', '/api/state')).body; const v = st.vers.prRep; const draft = st.db.prRep.find((r) => r.id === 'tt|44'); const sent = st.db.prRep.find((r) => r.id === 'tt|43');
  const code = async (doc, ver) => (await tinh.call('POST', '/api/sync', { ops: [put('prRep', doc, ver)] })).body.results[0].code;
  assert.strictEqual(await code({ ...draft, rows: { tt02: { t: -1, k: 0, d: '' } } }, v['tt|44']), 'forbidden', 'số âm');
  assert.strictEqual(await code({ ...draft, rows: { tt02: { t: 'abc', k: 0, d: '' } } }, v['tt|44']), 'forbidden', 'không phải số');
  assert.strictEqual(await code({ ...draft, rows: { tt02: { t: 1, k: 0, kl: -5, d: '' } } }, v['tt|44']), 'forbidden', 'kinh phí lũy kế chỉnh tay không âm');
  assert.strictEqual(await code({ ...sent, rows: { tt02: { t: 1, k: 0, d: '' } } }, v['tt|43']), 'forbidden', 'báo cáo đã chốt không sửa');
  assert.strictEqual(await code({ ...draft, week: 99 }, v['tt|44']), 'forbidden', 'không đổi tuần');
  assert.strictEqual((await tinh.call('POST', '/api/sync', { ops: [{ c: 'prRep', id: 'tt|44', op: 'del', base: v['tt|44'] }] })).body.results[0].code, 'forbidden', 'không xóa báo cáo tuần');
  const closed = (await tinh.call('POST', '/api/sync', { ops: [put('prRep', { ...draft, st: 'sent', closedAt: '2026-11-06T10:00', rows: { tt02: { t: 1, k: 0, d: '' } } }, v['tt|44'])] })).body.results[0]; assert.strictEqual(closed.ok, true, 'chốt báo cáo nháp: ' + JSON.stringify(closed));
  const s2 = (await tinh.call('GET', '/api/state')).body; assert.strictEqual(await code({ ...s2.db.prRep.find((r) => r.id === 'tt|44'), rows: { tt02: { t: 9, k: 0, d: '' } } }, s2.vers.prRep['tt|44']), 'forbidden', 'đã chốt thì không sửa số liệu nữa');
});

test('Chương trình khuyến nông: thêm và xóa hạng mục chỉ khi còn báo cáo tuần nháp', async () => {
  const tinh = client('0|tttt'); await tinh.login('khoa.pm.tinh'); const st = (await tinh.call('GET', '/api/state')).body;
  const mine = { id: 'dtcTEST1', prog: 'dt', tt: '7', lvl: 0, ten: 'Hội nghị thử (cuộc)', quyMo: 5, kh: null, lk0: 0, kp0: 0, lkText: '', ghiChu: '', grp: false, order: 20, custom: true, log: [] };
  const r1 = (await tinh.call('POST', '/api/sync', { ops: [put('prCat', mine, 0)] })).body.results[0]; assert.strictEqual(r1.ok, true, JSON.stringify(r1));
  assert.strictEqual((await tinh.call('POST', '/api/sync', { ops: [put('prCat', { ...mine, id: 'ttcTEST3', prog: 'tt', tt: '14' }, 0)] })).body.results[0].code, 'forbidden', 'chương trình thông tin đã chốt hết các tuần: không thêm hạng mục');
  assert.strictEqual((await tinh.call('POST', '/api/sync', { ops: [put('prCat', { ...mine, id: 'dtcTEST2', quyMo: -3 }, 0)] })).body.results[0].code, 'forbidden', 'quy mô phải > 0');
  assert.strictEqual((await tinh.call('POST', '/api/sync', { ops: [{ c: 'prCat', id: 'tt02', op: 'del', base: st.vers.prCat.tt02 }] })).body.results[0].code, 'forbidden', 'chương trình thông tin đã chốt hết các tuần: không xóa hạng mục');
  const delOrig = (await tinh.call('POST', '/api/sync', { ops: [{ c: 'prCat', id: 'dt06', op: 'del', base: st.vers.prCat.dt06 }] })).body.results[0]; assert.strictEqual(delOrig.ok, true, 'xóa được cả hạng mục có sẵn khi còn báo cáo nháp: ' + JSON.stringify(delOrig));
  const del = (await tinh.call('POST', '/api/sync', { ops: [{ c: 'prCat', id: 'dtcTEST1', op: 'del', base: r1.ver }] })).body.results[0]; assert.strictEqual(del.ok, true, JSON.stringify(del));
});

test('nạp bổ sung Chương trình khuyến nông cho cơ sở dữ liệu đã có dữ liệu (không đụng dữ liệu đang có, chạy lại an toàn)', async () => {
  const db = require('../server/db'); const seed = require('../server/seed');
  const before = await db.docs.count(); const had = (await db.query("SELECT COUNT(*)::int AS n FROM docs WHERE c IN ('prCat', 'prRep')")).rows[0].n; assert.strictEqual(await seed.ensureAdditive(), 0, 'đã có thì không nạp lại');
  await db.query("DELETE FROM docs WHERE c IN ('prCat', 'prRep')"); const cur0 = await db.docs.cursor();
  assert.strictEqual(await seed.ensureAdditive(), 29, 'thiếu cả hai thì nạp 25 + 4'); assert.strictEqual(await db.docs.count(), before - had + 29, 'chỉ thêm các bản ghi chương trình, không đụng dữ liệu khác');
  assert.ok((await db.docs.changesSince(cur0)).length >= 29, 'thay đổi được ghi vào nhật ký đồng bộ để trình duyệt đang mở nhận được');
  assert.strictEqual(await seed.ensureAdditive(), 0, 'chạy lại không nạp thêm');
  await db.query("DELETE FROM docs WHERE c = 'prRep'"); assert.strictEqual(await seed.ensureAdditive(), 0, 'chỉ thiếu một collection (đã có dữ liệu của người dùng) thì không nạp để khỏi ghi đè');
  const seedJson = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', 'data', 'seed.json'), 'utf8')); for (const d of seedJson.prRep) await db.docs.put('prRep', d.id, d, 'test');
});
