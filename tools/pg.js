'use strict';
// Quản lý PostgreSQL riêng của dự án:  node tools/pg.js start | stop | status | psql | info
const pg = require('../server/pg-local');
const { spawn } = require('child_process');
const cmd = process.argv[2] || 'status';
(async () => {
  if (cmd === 'start') { await pg.ensure(); console.log('PostgreSQL riêng đang chạy ở cổng', pg.PORT); }
  else if (cmd === 'stop') { console.log(pg.stop() ? 'Đã dừng PostgreSQL riêng.' : 'PostgreSQL riêng không chạy.'); }
  else if (cmd === 'status') { console.log(pg.running() ? 'Đang chạy ở cổng ' + pg.PORT : 'Đang dừng'); }
  else if (cmd === 'info') { console.log(`Máy chủ: 127.0.0.1\nCổng: ${pg.PORT}\nCơ sở dữ liệu: ${pg.DBNAME}\nNgười dùng: ${pg.USER}\nMật khẩu: nằm trong tệp ${require('path').join(pg.HOME, 'pg-password.txt')}\nThư mục dữ liệu: ${pg.DIR}`); }
  else if (cmd === 'psql') { await pg.ensure(); spawn(pg.exe('psql'), ['-h', '127.0.0.1', '-p', String(pg.PORT), '-U', pg.USER, '-d', pg.DBNAME], { stdio: 'inherit', env: { ...process.env, PGPASSWORD: pg.password() } }); }
  else console.log('Lệnh: start | stop | status | psql | info');
})().catch((e) => { console.error('Lỗi:', e.message); process.exit(1); });
