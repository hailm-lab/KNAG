'use strict';
/* Duyệt mọi mục menu của từng vai trò trên hệ thống thật (đã đăng nhập, dữ liệu từ máy chủ): không được có lỗi JavaScript hay màn hình báo lỗi hiển thị.
   Chạy:  node tests/screens.js */
const os = require('os');
const fs = require('fs');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bg-scr-'));
process.env.BG_OUTBOX_DIR = tmp;
const createTestDb = require('./testdb');
const puppeteer = require(path.join(__dirname, '..', '..', 'Prototype_Mobile', 'tools', 'node_modules', 'puppeteer-core'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SHOTS = path.join(__dirname, 'shots', 'screens'); fs.mkdirSync(SHOTS, { recursive: true });

const ROLES = [['Cấp Xã', 'an.nv.myhoahung'], ['Cấp Tỉnh (Quản trị nghiệp vụ)', 'binh.tt.tinh'], ['Cấp Tỉnh', 'khoa.pm.tinh'], ['Cấp TW', 'quan.lm.tw'], ['Admin', 'admin']];

(async () => {
  const tdb = await createTestDb('scr'); const { start } = require('../server/server'); const srv = await start(0, '127.0.0.1'); const url = `http://127.0.0.1:${srv.port}/`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  let total = 0; let bad = 0;
  for (const [label, user] of ROLES) {
    const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1388, height: 850 });
    const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
    p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errs.push('console: ' + m.text().slice(0, 140)); });
    await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.__appReady === true);
    await p.type('input[data-f="u"]', user); await p.type('input[data-f="pw"]', 'nongnghiep2026'); await p.click('[data-act="do-login"]');
    await p.waitForFunction(() => nav.cur().s === 'pick-role', { timeout: 8000 }); await p.click('[data-act="pick-dept"][data-id="tttt"]');
    await p.waitForFunction(() => App.state.session && nav.cur().s !== 'pick-role', { timeout: 10000 }); await sleep(500);
    const items = await p.evaluate(() => { const m = (typeof WM !== 'undefined' ? WM : {})[Session.level()]; return m ? m().flatMap((g) => g.items.filter((i) => i.s).map((i) => ({ s: i.s, t: i.t, p: i.p || {} }))) : []; });
    const seenBad = [];
    for (const it of items) {
      const before = errs.length;
      await p.evaluate((s, q) => nav.reset(s, q), it.s, it.p); await sleep(450);
      const shown = await p.evaluate(() => ({ s: nav.cur().s, bad: !!document.querySelector('.note.bad') && /Lỗi hiển thị/.test(document.body.innerText), len: document.body.innerText.length }));
      total++; const rj = await p.evaluate(() => (window.__sysRejects || []).splice(0)); if (rj.length) errs.push('máy chủ từ chối: ' + rj.map((r) => r.c + ': ' + r.msg).join('; '));
      if (errs.length > before || shown.bad || shown.len < 80) { bad++; seenBad.push(`${it.t} (${it.s}): ${errs.slice(before).join(' | ') || (shown.bad ? 'màn hình báo lỗi hiển thị' : 'màn hình trống')}`); }
    }
    console.log(`${bad === 0 || seenBad.length === 0 ? '✓' : '✗'} ${label}: ${items.length} mục menu${seenBad.length ? '\n    ' + seenBad.join('\n    ') : ''}`);
    await p.screenshot({ path: path.join(SHOTS, user + '.png') }); await ctx.close();
  }
  await browser.close(); clearInterval(srv.timer); await new Promise((res) => srv.server.close(res)); await tdb.drop();
  console.log(`\nĐã duyệt ${total} màn hình, ${bad} màn có lỗi.`); process.exitCode = bad ? 1 : 0;
})();
