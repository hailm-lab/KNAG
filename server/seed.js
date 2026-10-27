'use strict';
/* Nạp dữ liệu mẫu vào cơ sở dữ liệu. Chỉ chạy khi cơ sở dữ liệu còn trống (nạp lại không ghi đè dữ liệu thật).
   Dùng:  node server/seed.js            nạp nếu còn trống
          node server/seed.js --reset    XÓA TOÀN BỘ dữ liệu và nạp lại từ data/seed.json (đưa hệ thống về trạng thái ban đầu) */
const fs = require('fs');
const path = require('path');
const db = require('./db');
const auth = require('./auth');

/** Ba cán bộ Xã còn lại của dữ liệu mẫu (Châu Phú, An Châu, Hà Tiên) được mở tài khoản đăng nhập để thử nhiều xã cùng lúc */
const EXTRA_LOGINS = { u_bg2: 'ho.huu.thuy.chauphu', u_bg3: 'lam.minh.linh.anchau', u_bg4: 'le.duc.dat.hatien' };
const SEED_FILE = path.join(__dirname, '..', 'data', 'seed.json');

async function isEmpty() { return (await db.docs.count()) === 0; }

async function wipe() {
  await db.query('TRUNCATE docs, changes, credentials, sessions, reset_tokens, rate, audit, meta RESTART IDENTITY');
}

async function importSeed() {
  const seed = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8')); let n = 0;
  const adminPw = process.env.BG_ADMIN_PASSWORD;
  await db.tx(async (cl) => {
    for (const c of Object.keys(seed)) {
      for (const d of seed[c]) {
        const doc = { ...d };
        if (c === 'users' && EXTRA_LOGINS[doc.id]) { doc.username = EXTRA_LOGINS[doc.id]; delete doc.noLogin; }
        if (c === 'users') { const pw = doc.pw || 'nongnghiep2026'; delete doc.pw; await auth.setPassword(doc.id, doc.id === 'u_admin' && adminPw ? adminPw : pw, cl); }
        await db.docs.put(c, doc.id, doc, 'seed', cl); n++;
      }
    }
  });
  await db.meta.set('seeded_at', new Date().toISOString()); await db.meta.set('seed_docs', n);
  await db.audit(null, 'meta', 'seed', 'create', `Nạp dữ liệu mẫu: ${n} bản ghi`);
  return n;
}

async function ensureSeeded() {
  if (!(await isEmpty())) return false;
  if (!fs.existsSync(SEED_FILE)) { console.warn('Chưa có data/seed.json: cơ sở dữ liệu để trống.'); return false; }
  const n = await importSeed(); console.log(`Đã nạp dữ liệu mẫu: ${n} bản ghi.`); return true;
}

if (require.main === module) {
  (async () => {
    await db.init();
    if (process.argv.includes('--reset')) { await wipe(); const n = await importSeed(); console.log(`Đã đặt lại dữ liệu về trạng thái ban đầu: ${n} bản ghi.`); }
    else if (!(await ensureSeeded())) console.log('Cơ sở dữ liệu đã có dữ liệu, không nạp lại. Dùng --reset để đặt lại.');
    await db.close();
  })().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
}

module.exports = { ensureSeeded, importSeed, wipe, isEmpty };
