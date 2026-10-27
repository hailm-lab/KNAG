'use strict';
/* Kiểm thử đầu-cuối bằng trình duyệt thật: nhiều người dùng cùng làm việc trên một máy chủ.
   Kịch bản: An Châu (Cấp Xã) nhập và gửi báo giá → Cấp Tỉnh thấy tiến độ cập nhật → quá giờ khóa, Xã bị chặn →
   Cấp Tỉnh xử lý cảnh báo, duyệt và công bố → Xã và Cấp TW thấy bảng giá đã công bố; dữ liệu còn nguyên sau khi tải lại trang.
   Chạy:  node tests/e2e.js   (cần Chrome; dùng cơ sở dữ liệu tạm) */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-e2e-'));
process.env.BG_OUTBOX_DIR = tmp;
const createTestDb = require('./testdb');
const puppeteer = require(path.join(__dirname, '..', '..', 'Prototype_Mobile', 'tools', 'node_modules', 'puppeteer-core'));
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);

(async () => {
  const tdb = await createTestDb('e2e'); const { start } = require('../server/server'); const srv = await start(0, '127.0.0.1'); const url = `http://127.0.0.1:${srv.port}/`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const errors = [];
  const open = async (name) => {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1388, height: 850 });
    p.on('pageerror', (e) => errors.push(`[${name}] ${String(e).slice(0, 140)}`));
    await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.__appReady === true);
    return { p, name, ctx };
  };
  const login = async (u, user, pw) => {
    const { p } = u; await p.type('input[data-f="u"]', user); await p.type('input[data-f="pw"]', pw || 'nongnghiep2026');
    await p.click('[data-act="do-login"]'); await p.waitForFunction(() => nav.cur().s === 'pick-role', { timeout: 8000 });
    await p.click('[data-act="pick-dept"][data-id="tttt"]'); await sleep(300);
    const go = await p.$('[data-act="pick-go"], [data-act="pick-enter"]'); if (go) await go.click();
    await p.waitForFunction(() => App.state.session && nav.cur().s !== 'pick-role', { timeout: 10000 }); await sleep(400);
  };
  const click = async (u, act, sel) => { await u.p.evaluate((a, s) => { const e = document.querySelector(s || `[data-act="${a}"]`); if (!e) throw new Error('Không thấy nút ' + a); e.click(); }, act, sel); await sleep(350); };
  const text = (u) => u.p.evaluate(() => document.body.innerText);
  const go = async (u, screen, params) => { await u.p.evaluate((s, q) => { nav.reset(s, q || {}); }, screen, params); await sleep(500); };
  const noRej = async (u, label) => { const r = await u.p.evaluate(() => (window.__sysRejects || []).splice(0)); assert.deepStrictEqual(r, [], label + ': máy chủ từ chối ngầm ' + JSON.stringify(r)); };
  const sendOk = async (u) => { await u.p.evaluate(() => { const b = document.querySelector('[data-act="dlg-ok"]'); if (b) b.click(); }); await sleep(500); };

  try {
    console.log('E2E — hệ thống Báo giá nông sản');
    const xa = await open('An Châu'); const tinh = await open('Cấp Tỉnh'); const adm = await open('Admin'); const tw = await open('Cấp TW');

    /* 1. Đăng nhập thật */
    await login(xa, 'lam.minh.linh.anchau'); assert.strictEqual(await xa.p.evaluate(() => Session.level()), 'xa'); ok('Cán bộ An Châu đăng nhập bằng tài khoản thật, vào được màn Nhập báo giá');
    await login(tinh, 'binh.tt.tinh'); await login(adm, 'admin'); await login(tw, 'quan.lm.tw');
    ok('Cấp Tỉnh, Admin, Cấp TW đăng nhập ở 3 phiên trình duyệt riêng');
    assert.ok(!(await xa.p.evaluate(() => JSON.stringify(App.state.db.users).includes('"pw"'))), 'trình duyệt không nhận mật khẩu'); ok('Trình duyệt không nhận được mật khẩu của bất kỳ ai');

    /* 2. Xã nhập và gửi báo giá */
    await go(xa, 'bg-entry'); assert.strictEqual(await xa.p.evaluate(() => nav.cur().s), 'bg-entry');
    await click(xa, 'bgx-prev'); const filled = await xa.p.evaluate(() => Object.keys(Form.v).filter((k) => k.startsWith('lo_') && Form.v[k]).length); assert.ok(filled >= 10, 'lấy giá kỳ trước điền được nhiều dòng: ' + filled);
    await xa.p.screenshot({ path: path.join(SHOTS, '01_xa_nhap_gia.png') });
    await click(xa, 'bgx-send'); await sendOk(xa); await sleep(900);
    const sent = await xa.p.evaluate(() => { const p = BG.phieu('bx03', bgToday()); return p && p.st; });
    assert.strictEqual(sent, 'sent', 'phiếu An Châu đã gửi (trạng thái ' + sent + ')'); ok('An Châu bấm "Gửi báo giá": phiếu chuyển sang Đã gửi'); await noRej(xa, 'gửi báo giá');
    const onServer = await (async () => { const r = await fetch(url + 'api/health'); return r.ok; })(); assert.ok(onServer);

    /* 3. Cấp Tỉnh thấy tiến độ mới sau vài giây (đồng bộ) */
    await go(tinh, 'bg-progress'); await sleep(4500);
    const seen = await tinh.p.evaluate(() => { const p = BG.phieu('bx03', bgToday()); return p ? p.st : null; });
    assert.strictEqual(seen, 'sent'); ok('Cấp Tỉnh thấy phiếu An Châu đã gửi mà không cần tải lại trang (đồng bộ tự động)');
    await tinh.p.screenshot({ path: path.join(SHOTS, '02_tinh_tien_do.png') });

    /* 4. Qua giờ khóa: Admin chỉnh đồng hồ hệ thống, Xã bị chặn theo giờ MÁY CHỦ */
    await go(adm, 'bg-demo'); await click(adm, null, '[data-act="bgd-clock"][data-t$="T12:00"]'); await sleep(900);
    await sleep(3500);
    const clk = await xa.p.evaluate(() => bgSys().clock); assert.ok(clk.endsWith('T12:00'), 'Xã nhận đồng hồ mới: ' + clk); ok('Admin chỉnh đồng hồ hệ thống sang 12:00, Cấp Xã nhận ngay đồng hồ mới'); await noRej(adm, 'chỉnh đồng hồ');
    await xa.p.evaluate(() => { const p = BG.phieu('bx03', bgToday()); p.items.jasmine.lo = 1; p.items.jasmine.hi = 2; saveState(); });
    await sleep(1200); const after = await xa.p.evaluate(() => BG.phieu('bx03', bgToday()).items.jasmine.lo);
    assert.notStrictEqual(after, 1, 'bản của máy chủ được hoàn lại'); const rj7 = await xa.p.evaluate(() => (window.__sysRejects || []).splice(0)); assert.ok(rj7.length === 1 && /giờ khóa/.test(rj7[0].msg), 'một từ chối đúng lý do giờ khóa'); ok('Sau 12:00, Cấp Xã sửa phiếu bị máy chủ từ chối (đúng lý do giờ khóa) và dữ liệu được hoàn lại');

    /* 5. Cấp Tỉnh xử lý cảnh báo, duyệt và công bố */
    await go(tinh, 'bg-review'); await sleep(500);
    const un = await tinh.p.evaluate(() => BG.unhandled(bgToday()).length); assert.ok(un >= 1, 'còn cảnh báo chưa xử lý'); ok(`Cấp Tỉnh thấy ${un} cảnh báo chưa xử lý nên chưa duyệt được`);
    await tinh.p.evaluate(() => { BG.unhandled(bgToday()).forEach((a) => BG.resolveAlert(a, 'giu', 'Chấp nhận giá xã gửi (kiểm thử)')); });
    await sleep(1500); const left = await tinh.p.evaluate(() => BG.unhandled(bgToday()).length); assert.strictEqual(left, 1, 'còn 1 cảnh báo của xã do cán bộ Tỉnh khác phụ trách'); const rj9 = await tinh.p.evaluate(() => (window.__sysRejects || []).splice(0)); assert.ok(rj9.length >= 1 && /phân công/.test(rj9[0].msg), 'có từ chối đúng lý do phân công'); ok('Cấp Tỉnh chỉ xử lý được cảnh báo của xã mình phụ trách; cảnh báo xã Châu Phú (cán bộ Tỉnh khác) bị máy chủ từ chối');
    const khoa = await open('Cán bộ Tỉnh khác'); await login(khoa, 'khoa.pm.tinh');
    await khoa.p.evaluate(() => { BG.unhandled(bgToday()).forEach((a) => BG.resolveAlert(a, 'giu', 'Đã trao đổi với xã, giữ nguyên (kiểm thử)')); }); await sleep(1500);
    await sleep(3500); const un2 = await tinh.p.evaluate(() => BG.unhandled(bgToday()).length); assert.strictEqual(un2, 0); ok('Cán bộ Tỉnh phụ trách Châu Phú xử lý cảnh báo của xã mình; Cấp Tỉnh kia thấy hết cảnh báo sau vài giây');
    await tinh.p.evaluate(() => { BG.approve(bgToday()); }); await sleep(2000);
    const st = await tinh.p.evaluate(() => BG.boardPeek(bgToday()).st); assert.strictEqual(st, 'approved', 'trạng thái bảng giá: ' + st); await noRej(tinh, 'xử lý cảnh báo và duyệt'); await noRej(khoa, 'xử lý cảnh báo'); ok('Cấp Tỉnh duyệt bảng giá ngày 15/10/2026');
    await tinh.p.screenshot({ path: path.join(SHOTS, '03_tinh_da_duyet.png') });

    /* 6. Xã và Cấp TW thấy bảng giá công bố */
    await sleep(3500);
    const xaBoard = await xa.p.evaluate(() => BG.boardPeek(bgToday()).st); const twBoard = await tw.p.evaluate(() => BG.boardPeek(bgToday()).st);
    assert.strictEqual(xaBoard, 'approved'); assert.strictEqual(twBoard, 'approved'); ok('Cấp Xã và Cấp TW thấy bảng giá đã công bố (đồng bộ tự động)');
    await go(tw, 'bg-board-view'); await tw.p.screenshot({ path: path.join(SHOTS, '04_tw_bang_gia.png') });
    assert.ok(!(await tw.p.evaluate(() => JSON.stringify(App.state.db.bgSrv).includes('"farmer"'))), 'Cấp TW không nhận tên nông hộ'); ok('Cấp TW không nhận tên, số điện thoại nông hộ');

    /* 7. Sau khi duyệt, Cấp Tỉnh sửa giá bị chặn */
    await tinh.p.evaluate(() => { const p = BG.phieu('bx03', bgToday()); p.items.jasmine.adj = { lo: 1000, hi: 2000 }; saveState(); });
    await sleep(1200); const adj = await tinh.p.evaluate(() => BG.phieu('bx03', bgToday()).items.jasmine.adj); assert.ok(!adj, 'hiệu chỉnh bị từ chối sau khi duyệt'); await tinh.p.evaluate(() => (window.__sysRejects || []).splice(0)); ok('Sau khi duyệt, hiệu chỉnh giá bị máy chủ từ chối (phải mở duyệt trước)');

    /* 8. Dữ liệu nằm ở máy chủ: tải lại trang vẫn còn */
    const again = await open('An Châu (mở lại)'); await login(again, 'lam.minh.linh.anchau');
    const kept = await again.p.evaluate(() => { const p = BG.phieu('bx03', bgToday()); return p ? p.st : null; }); assert.strictEqual(kept, 'sent'); ok('Mở trình duyệt mới, đăng nhập lại: báo giá đã gửi vẫn còn (lưu ở máy chủ)');

    /* 9. Đăng xuất */
    await click(tinh, 'wusermenu'); await click(tinh, 'logout'); await sleep(300); await sendOk(tinh); await sleep(700);
    const me = await tinh.p.evaluate(() => fetch('/api/me').then((r) => r.status)); assert.strictEqual(me, 401); ok('Đăng xuất hủy phiên trên máy chủ');

    assert.deepStrictEqual(errors, [], 'không có lỗi JavaScript trong trình duyệt: ' + errors.join(' | ')); ok('Không có lỗi JavaScript ở cả 5 phiên trình duyệt');
    console.log(`\nKẾT QUẢ: ${n} bước đạt. Ảnh chụp trong tests/shots/`);
  } catch (e) {
    console.error('\n✗ THẤT BẠI sau bước', n, '\n', e.message); if (errors.length) console.error('Lỗi JS:', errors); process.exitCode = 1;
  } finally { await browser.close(); clearInterval(srv.timer); await new Promise((res) => srv.server.close(res)); await tdb.drop(); }
})();
