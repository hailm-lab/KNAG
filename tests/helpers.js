'use strict';
/* Bộ công cụ dùng chung cho các kiểm thử trình duyệt: máy chủ tạm + nhiều phiên đăng nhập riêng + kiểm tra "không có thay đổi hợp lệ nào bị từ chối ngầm". */
const os = require('os');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert');

module.exports = async function harness(prefix) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `bg-${prefix}-`)); process.env.BG_OUTBOX_DIR = tmp;
  const tdb = await require('./testdb')(prefix); const { start } = require('../server/server');
  const puppeteer = require(path.join(__dirname, '..', '..', 'Prototype_Mobile', 'tools', 'node_modules', 'puppeteer-core'));
  const srv = await start(0, '127.0.0.1'); const url = `http://127.0.0.1:${srv.port}/`;
  const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' });
  const errors = []; const shots = path.join(__dirname, 'shots'); fs.mkdirSync(shots, { recursive: true });
  let n = 0;
  const h = {
    assert, url, errors, shots, path,
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    ok(m) { console.log(`  ✓ ${++n}. ${m}`); },
    get count() { return n; },
    async open(name) {
      const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: 1388, height: 850 });
      p.on('pageerror', (e) => errors.push(`[${name}] ${String(e).slice(0, 140)}`)); await p.goto(url, { waitUntil: 'load' }); await p.waitForFunction(() => window.__appReady === true);
      return { p, name };
    },
    async login(u, user) {
      await u.p.type('input[data-f="u"]', user); await u.p.type('input[data-f="pw"]', 'nongnghiep2026'); await u.p.click('[data-act="do-login"]');
      await u.p.waitForFunction(() => nav.cur().s === 'pick-role', { timeout: 8000 }); await u.p.click('[data-act="pick-dept"][data-id="tttt"]');
      await u.p.waitForFunction(() => App.state.session && nav.cur().s !== 'pick-role', { timeout: 10000 }); await h.sleep(400); await h.rejects(u);
    },
    async go(u, s, q) { await u.p.evaluate((a, b) => nav.reset(a, b || {}), s, q); await h.sleep(500); },
    async clickSel(u, sel) { const r = await u.p.evaluate((s) => { const e = document.querySelector(s); if (!e) return false; e.click(); return true; }, sel); if (!r) throw new Error('Không thấy ' + sel); await h.sleep(450); },
    async clickText(u, re, scope) { const r = await u.p.evaluate((src, sc) => { const R = new RegExp(src); const e = [...document.querySelectorAll((sc || '') + ' button, ' + (sc || '') + ' .btn')].find((b) => R.test(b.innerText) && !b.disabled); if (!e) return false; e.click(); return true; }, re.source, scope || ''); if (!r) throw new Error('Không thấy nút ' + re); await h.sleep(450); },
    async type(u, name, v) { await u.p.evaluate((nm, val) => { const f = document.querySelector(`[data-f="${nm}"]`); if (!f) throw new Error('Không thấy ô ' + nm); f.value = val; f.dispatchEvent(new Event('input', { bubbles: true })); }, name, v); },
    rejects(u) { return u.p.evaluate(() => (window.__sysRejects || []).splice(0)); },
    async noRejects(u, label) { const r = await h.rejects(u); assert.deepStrictEqual(r, [], `${label}: máy chủ từ chối ngầm ${JSON.stringify(r)}`); },
    async setClock(adm, clock) { await adm.p.evaluate((c) => { bgSys().clock = c; saveState(); }, clock); await h.sleep(900); },
    async confirm(u) { await u.p.evaluate(() => { const b = document.querySelector('[data-act="dlg-ok"]'); if (b) b.click(); }); await h.sleep(900); },
    async finish(err) {
      if (err) { console.error('\n✗ THẤT BẠI sau bước', n, '\n', err.message); if (errors.length) console.error('Lỗi JS:', errors); process.exitCode = 1; } else { try { assert.deepStrictEqual(errors, [], 'có lỗi JavaScript: ' + errors.join(' | ')); h.ok('Không có lỗi JavaScript ở mọi phiên trình duyệt'); console.log(`\nKẾT QUẢ: ${n} bước đạt.`); } catch (e) { console.error(e.message); process.exitCode = 1; } }
      await browser.close(); clearInterval(srv.timer); await new Promise((res) => srv.server.close(res)); await tdb.drop();
    },
  };
  return h;
};
