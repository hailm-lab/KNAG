// Xuất dữ liệu mẫu từ bản web Báo giá (bản DULIEUMAU) ra data/seed.json để nạp vào cơ sở dữ liệu của máy chủ.
// Chạy: node tools/export-seed.js   (cần puppeteer-core trong Prototype_Mobile/tools/node_modules và Chrome)
const path = require('path'); const fs = require('fs'); const { pathToFileURL } = require('url');
const ROOT = path.join(__dirname, '..', '..'); const PROTO = path.join(ROOT, 'Prototype_Mobile');
const puppeteer = require(path.join(PROTO, 'tools', 'node_modules', 'puppeteer-core'));
const SRC = process.env.SEED_HTML || path.join(ROOT, 'Prototype_BaoGia_Web_DULIEUMAU.html');
const KEEP = (k) => k.startsWith('bg') || ['xa', 'depts', 'users', 'notifs'].includes(k);
(async () => {
  const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new' }); const p = await b.newPage();
  await p.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
  await p.evaluate(async () => { try { localStorage.clear(); } catch (e) {} await new Promise((r) => { const q = indexedDB.deleteDatabase('kns-proto'); q.onsuccess = q.onerror = q.onblocked = () => r(); }); });
  await p.reload({ waitUntil: 'load' }); await p.waitForFunction(() => window.__appReady === true, { timeout: 30000 });
  const db = await p.evaluate(() => JSON.parse(JSON.stringify(App.state.db)));
  await b.close();
  const out = {}; Object.keys(db).filter(KEEP).forEach((k) => { if (Array.isArray(db[k])) out[k] = db[k]; });
  // chỉ giữ thông báo thuộc phòng Thông tin tuyên truyền
  out.notifs = (out.notifs || []).filter((n) => n.dept === 'tttt');
  fs.mkdirSync(path.join(__dirname, '..', 'data'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'seed.json'), JSON.stringify(out));
  console.log('Đã xuất', Object.keys(out).length, 'collection:', Object.keys(out).map((k) => `${k}(${out[k].length})`).join(' '));
})();
