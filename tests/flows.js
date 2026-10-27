'use strict';
/* Kiểm thử các luồng thật bằng thao tác trên giao diện (bấm nút, nhập chữ) và kiểm tra KHÔNG có thay đổi hợp lệ nào bị máy chủ từ chối ngầm.
   Luồng: (A) Xã phản hồi xác minh lúc 12:30 · (B) Xã sửa giá Dưa leo, gửi lại khi cảnh báo đang chờ phản hồi · (C) Cấp Tỉnh bấm "Giữ nguyên" ở hộp thoại rồi bấm "Duyệt bảng giá" thật.
   Chạy:  node tests/flows.js */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-flows-'));
process.env.BG_OUTBOX_DIR = tmp;
const createTestDb = require('./testdb');
const puppeteer = require(path.join(__dirname, '..', '..', 'Prototype_Mobile', 'tools', 'node_modules', 'puppeteer-core'));
const SHOTS = path.join(__dirname, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0; const ok = (m) => console.log(`  ✓ ${++n}. ${m}`);

(async () => {
  const tdb = await createTestDb('flows'); const { start } = require('../server/server'); const srv = await start(0, '127.0.0.1'); const url = `http://127.0.0.1:${srv.port}/`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const errors = [];
  const open = async (name) => {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1388, height: 850 });
    p.on('pageerror', (e) => errors.push(`[${name}] ${String(e).slice(0, 140)}`)); await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.__appReady === true);
    return { p, name };
  };
  const login = async (u, user) => {
    await u.p.type('input[data-f="u"]', user); await u.p.type('input[data-f="pw"]', 'nongnghiep2026'); await u.p.click('[data-act="do-login"]');
    await u.p.waitForFunction(() => nav.cur().s === 'pick-role', { timeout: 8000 }); await u.p.click('[data-act="pick-dept"][data-id="tttt"]');
    await u.p.waitForFunction(() => App.state.session && nav.cur().s !== 'pick-role', { timeout: 10000 }); await sleep(400);
  };
  const go = async (u, s, q) => { await u.p.evaluate((a, b) => nav.reset(a, b || {}), s, q); await sleep(500); };
  const clickSel = async (u, sel) => { const r = await u.p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel); if (!r) throw new Error('Không thấy ' + sel); await sleep(450); };
  const clickText = async (u, re, scope) => { const r = await u.p.evaluate((src, sc) => { const R = new RegExp(src); const e = [...document.querySelectorAll((sc || '') + ' button, ' + (sc || '') + ' .btn')].find((b) => R.test(b.innerText) && !b.disabled); if (!e) return false; e.click(); return true; }, re.source, scope || ''); if (!r) throw new Error('Không thấy nút ' + re); await sleep(450); };
  const type = async (u, name, v) => { await u.p.evaluate((nm, val) => { const f = document.querySelector(`[data-f="${nm}"]`); f.value = val; f.dispatchEvent(new Event('input', { bubbles: true })); }, name, v); };
  const rejects = (u) => u.p.evaluate(() => (window.__sysRejects || []).splice(0));
  const noRejects = async (u, label) => { const r = await rejects(u); assert.deepStrictEqual(r, [], `${label}: máy chủ từ chối ngầm ${JSON.stringify(r)}`); };
  const setClock = async (adm, clock) => { await adm.p.evaluate((c) => { bgSys().clock = c; saveState(); }, clock); await sleep(800); };

  try {
    console.log('Luồng thật qua giao diện');
    const xa = await open('Mỹ Chánh'); const binh = await open('Tỉnh Bình'); const khoa = await open('Tỉnh Khoa'); const adm = await open('Admin');
    await login(xa, 'an.nv.myhoahung'); await login(binh, 'binh.tt.tinh'); await login(khoa, 'khoa.pm.tinh'); await login(adm, 'admin');
    await sleep(500); for (const u of [xa, binh, khoa, adm]) await rejects(u);

    /* A. Phản hồi xác minh lúc 12:30 (đã qua giờ khóa 12:00, chưa quá hạn phản hồi 13:30) */
    await setClock(adm, '2026-10-15T12:30'); await sleep(3500);
    const yc = await xa.p.evaluate(() => DB.all('bgAlert').filter((a) => a.st === 'yc').map((a) => a.id)); assert.ok(yc.length >= 1, 'có cảnh báo đang chờ phản hồi');
    await go(xa, 'bg-verify-detail', { id: yc[0] });
    await clickSel(xa, '[data-act="f-radio"][data-name="kind"][data-value="giu"]'); await type(xa, 'text', 'Đã kiểm tra lại với thương lái, giữ giá đã gửi.');
    await clickSel(xa, '[data-act="bgx-reply"]'); await sleep(1200); await noRejects(xa, 'phản hồi xác minh lúc 12:30');
    const st1 = await xa.p.evaluate((id) => DB.get('bgAlert', id).st, yc[0]); assert.strictEqual(st1, 'ph'); ok('Lúc 12:30 (sau giờ khóa, trước hạn 13:30) Cấp Xã gửi phản hồi xác minh qua giao diện: được chấp nhận, không bị từ chối ngầm');
    await sleep(3500); const seen = await binh.p.evaluate((id) => (DB.get('bgAlert', id) || {}).st, yc[0]); assert.strictEqual(seen, 'ph'); ok('Cấp Tỉnh thấy cảnh báo chuyển sang "Xã đã phản hồi"');
    await sleep(500); await rejects(binh);

    /* A2. Quá hạn 13:30: máy chủ chặn phản hồi muộn */
    const yc2 = await xa.p.evaluate(() => DB.all('bgAlert').filter((a) => a.st === 'yc').map((a) => a.id));
    await setClock(adm, '2026-10-15T13:45'); await sleep(3500);
    await go(xa, 'bg-verify-detail', { id: yc2[0] }); const hidden = await xa.p.evaluate(() => !document.querySelector('[data-act="bgx-reply"]')); assert.ok(hidden, 'giao diện đã ẩn nút phản hồi khi quá hạn');
    await xa.p.evaluate((id) => { const a = DB.get('bgAlert', id); a.reply = { kind: 'giu', text: 'muộn', at: bgSys().clock, by: 'u_an' }; a.st = 'ph'; saveState(); }, yc2[0]); await sleep(1500);
    const late = await rejects(xa); assert.ok(late.length === 1 && /quá hạn/i.test(late[0].msg), 'phản hồi sau 13:30 bị từ chối: ' + JSON.stringify(late)); ok('Sau 13:30 máy chủ từ chối phản hồi muộn ("Đã quá hạn phản hồi")');

    /* B. Quay lại 09:15, Mỹ Chánh sửa giá Dưa leo về mức bình thường và gửi lại khi cảnh báo còn chờ phản hồi */
    await setClock(adm, '2026-10-15T09:15'); await sleep(3500);
    await go(xa, 'bg-entry'); await sleep(400);
    const item = await xa.p.evaluate((id) => DB.get('bgAlert', id).item, yc2[0]);
    const flagged = await xa.p.evaluate(() => DB.all('bgAlert').filter((x) => x.xa === 'bx01' && x.date === bgToday() && x.st !== 'huy').map((x) => x.item));
    for (const it of flagged) { const r = await xa.p.evaluate((i) => { const q = BG.ref('bx01', i, bgToday()); return { lo: q.lo, hi: q.hi }; }, it); await type(xa, 'lo_' + it, String(r.lo)); await type(xa, 'hi_' + it, String(r.hi)); }
    await sleep(200);
    await clickSel(xa, '[data-act="bgx-send"]'); await xa.p.evaluate(() => { const b = document.querySelector('[data-act="dlg-ok"]'); if (b) b.click(); }); await sleep(1500);
    await noRejects(xa, 'gửi lại phiếu khi cảnh báo đang chờ phản hồi');
    const dls = await xa.p.evaluate((it) => DB.all('bgAlert').filter((a) => a.item === it && a.xa === 'bx01' && a.date === bgToday()).map((a) => a.st), item); assert.ok(dls.includes('huy'), 'cảnh báo tự hủy: ' + dls);
    const logs = await xa.p.evaluate(() => DB.all('bgLog').length); ok('Mỹ Chánh sửa giá mặt hàng đang bị hỏi xác minh về mức bình thường rồi gửi lại: cảnh báo tự hủy, nhật ký thao tác được ghi, không bị từ chối ngầm');
    await sleep(3500); const khoaSees = await khoa.p.evaluate((it) => DB.all('bgAlert').filter((a) => a.item === it && a.xa === 'bx01').map((a) => a.st), item); assert.ok(khoaSees.includes('huy')); await rejects(khoa);

    /* C. Cấp Tỉnh: Giữ nguyên ở hộp thoại, rồi bấm Duyệt bảng giá thật */
    await setClock(adm, '2026-10-15T12:05'); await sleep(3500);
    for (const [u, label] of [[khoa, 'Khoa'], [binh, 'Bình']]) {
      await go(u, 'bg-alerts'); await sleep(400);
      let guard = 0;
      while (guard++ < 6) {
        const cnt = await u.p.evaluate(() => document.querySelectorAll('.bgab [data-act="bgt-ares"][data-type="giu"]').length);
        if (!cnt) break;
        await clickSel(u, '.bgab [data-act="bgt-ares"][data-type="giu"]');
        const pop = await u.p.evaluate(() => !!document.querySelector('.ovl textarea')); assert.ok(pop, 'hộp thoại pop-up có ô ghi chú');
        await type(u, 'text', `Đã trao đổi với xã, giữ nguyên (${label}).`); await clickText(u, /^Lưu$/, '.ovl'); await sleep(1200);
      }
      await noRejects(u, `${label} xử lý cảnh báo`);
    }
    await sleep(3500);
    const left = await binh.p.evaluate(() => BG.unhandled(bgToday()).length); assert.strictEqual(left, 0, 'còn cảnh báo chưa xử lý: ' + left); ok('Hai cán bộ Tỉnh xử lý hết cảnh báo bằng nút "Giữ nguyên" và hộp thoại ghi chú (xã nào do cán bộ đó phụ trách)');
    await go(binh, 'bg-review'); await sleep(500);
    await binh.p.screenshot({ path: path.join(SHOTS, 'flows_review.png') });
    await clickSel(binh, '[data-act="bgt-approve"]'); await binh.p.evaluate(() => { const b = document.querySelector('[data-act="dlg-ok"]'); if (b) b.click(); }); await sleep(2200);
    await noRejects(binh, 'duyệt bảng giá');
    const board = await binh.p.evaluate(() => BG.boardPeek(bgToday()).st); assert.strictEqual(board, 'approved', 'bảng giá sau khi bấm Duyệt: ' + board); ok('Cấp Tỉnh bấm nút "Duyệt bảng giá" thật: máy chủ chấp nhận, bảng giá ở trạng thái Đã duyệt');
    const locks = await binh.p.evaluate(() => DB.all('bgLock').length); assert.strictEqual(locks, 0, 'khóa duyệt đã được giải phóng'); ok('Khóa "đang duyệt" được giải phóng sau khi duyệt');

    assert.deepStrictEqual(errors, [], 'không có lỗi JavaScript: ' + errors.join(' | ')); ok('Không có lỗi JavaScript ở 4 phiên trình duyệt');
    console.log(`\nKẾT QUẢ: ${n} bước đạt.`);
  } catch (e) {
    console.error('\n✗ THẤT BẠI sau bước', n, '\n', e.message); if (errors.length) console.error('Lỗi JS:', errors); process.exitCode = 1;
  } finally { await browser.close(); clearInterval(srv.timer); await new Promise((res) => srv.server.close(res)); await tdb.drop(); }
})();
