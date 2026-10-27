'use strict';
// Sao lưu cơ sở dữ liệu PostgreSQL bằng pg_dump (định dạng custom, nén) vào thư mục backups ở cạnh dữ liệu PostgreSQL. Chạy:  node tools/backup.js
// Khôi phục:  pg_restore --clean --if-exists -d <chuỗi kết nối> <tệp .dump>
const path = require('path');
const fs = require('fs');
const pgLocal = require('../server/pg-local');

(async () => {
  const url = process.env.DATABASE_URL || await pgLocal.ensure();
  const dir = path.join(process.env.BG_BACKUP_DIR || path.join(pgLocal.HOME, 'backups')); fs.mkdirSync(dir, { recursive: true });
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  const file = path.join(dir, `baogia-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.dump`);
  const r = pgLocal.run('pg_dump', ['-Fc', '-f', file, '--dbname', url]);
  if (r.status !== 0) { console.error('pg_dump lỗi:', (r.stderr || r.stdout || '').trim()); process.exit(1); }
  console.log('Đã sao lưu:', file, (fs.statSync(file).size / 1024).toFixed(0) + ' KB');
  console.log('Khôi phục: pg_restore --clean --if-exists --dbname "<chuỗi kết nối>" "' + file + '"');
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
