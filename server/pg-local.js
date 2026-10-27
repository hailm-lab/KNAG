'use strict';
/* PostgreSQL riêng của dự án (không đụng tới PostgreSQL đang chạy trên máy):
   dùng chương trình PostgreSQL đã cài sẵn (initdb, pg_ctl) để tạo một "cụm" dữ liệu và chạy ở cổng 5440, chỉ nghe 127.0.0.1.
   Mật khẩu sinh ngẫu nhiên lần đầu, lưu trong pg-password.txt cùng thư mục. Không cần quyền Administrator.
   Thư mục dữ liệu PHẢI nằm ở đường dẫn không có dấu tiếng Việt (initdb của PostgreSQL trên Windows không đọc được đường dẫn có dấu),
   nên mặc định là %LOCALAPPDATA%\BaoGiaNongSan, không nằm trong thư mục dự án (tên thư mục dự án có chữ "KHUYẾN Nông").
   Muốn dùng PostgreSQL khác (máy chủ của đơn vị): đặt biến DATABASE_URL, mô-đun này sẽ không được dùng. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME = process.env.BG_PG_HOME || path.join(process.env.LOCALAPPDATA || os.homedir(), 'BaoGiaNongSan');
const DIR = path.join(HOME, 'pgdata');
const PORT = +(process.env.BG_PG_PORT || 5440);
const USER = 'bg_admin';
const DBNAME = process.env.BG_PG_DB || 'baogia';
const PWFILE = path.join(HOME, 'pg-password.txt');
const LOG = path.join(HOME, 'pg.log');
const NON_ASCII = /[^\x00-\x7F]/;

function binDir() {
  if (process.env.PG_BIN && fs.existsSync(path.join(process.env.PG_BIN, 'pg_ctl.exe'))) return process.env.PG_BIN;
  for (const v of [18, 17, 16, 15, 14]) { const d = `C:/Program Files/PostgreSQL/${v}/bin`; if (fs.existsSync(path.join(d, 'pg_ctl.exe'))) return d; }
  throw new Error('Không tìm thấy PostgreSQL đã cài (pg_ctl.exe). Cài PostgreSQL 14 trở lên, hoặc đặt PG_BIN trỏ tới thư mục bin, hoặc đặt DATABASE_URL tới một máy chủ PostgreSQL có sẵn.');
}
const exe = (n) => path.join(binDir(), n + '.exe');
/** Chạy một chương trình PostgreSQL. Với pg_ctl start phải đặt stdio: ignore, nếu không sẽ bị treo vì tiến trình máy chủ giữ ống đầu ra mở */
function run(name, args, opt = {}) { return spawnSync(exe(name), args, { encoding: 'utf8', windowsHide: true, ...opt }); }

function password() {
  fs.mkdirSync(HOME, { recursive: true });
  if (!fs.existsSync(PWFILE)) fs.writeFileSync(PWFILE, crypto.randomBytes(18).toString('base64url'), 'utf8');
  return fs.readFileSync(PWFILE, 'utf8').trim();
}
const url = (db) => `postgresql://${USER}:${encodeURIComponent(password())}@127.0.0.1:${PORT}/${db || DBNAME}`;

function init() {
  if (NON_ASCII.test(HOME)) throw new Error('Đường dẫn dữ liệu PostgreSQL có ký tự có dấu (' + HOME + '). Đặt BG_PG_HOME tới một đường dẫn chỉ gồm chữ không dấu.');
  if (fs.existsSync(path.join(DIR, 'PG_VERSION'))) return false;
  const pwf = path.join(HOME, '.pg-init-pw'); fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(pwf, password(), 'utf8');
  const r = run('initdb', ['-D', DIR, '-U', USER, '--pwfile', pwf, '-A', 'scram-sha-256', '-E', 'UTF8', '--no-locale']);
  try { fs.unlinkSync(pwf); } catch (e) { /* đã xóa */ }
  if (r.status !== 0) throw new Error('initdb lỗi: ' + (r.stderr || r.stdout));
  return true;
}
const running = () => run('pg_ctl', ['status', '-D', DIR]).status === 0;
function start() {
  if (running()) return false;
  const r = run('pg_ctl', ['start', '-D', DIR, '-l', LOG, '-w', '-t', '60', '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`], { stdio: 'ignore' });
  if (r.status !== 0) throw new Error('Không khởi động được PostgreSQL riêng (xem ' + LOG + ')');
  return true;
}
function stop() { if (!running()) return false; const r = run('pg_ctl', ['stop', '-D', DIR, '-m', 'fast', '-w'], { stdio: 'ignore' }); if (r.status !== 0) throw new Error('Không dừng được PostgreSQL riêng'); return true; }

/** Bảo đảm cụm dữ liệu đã tạo, đang chạy và có cơ sở dữ liệu; trả về chuỗi kết nối */
async function ensure() {
  init(); start();
  const { Client } = require('pg'); const c = new Client({ connectionString: url('postgres') }); await c.connect();
  try { const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [DBNAME]); if (!r.rowCount) await c.query(`CREATE DATABASE "${DBNAME}" ENCODING 'UTF8' TEMPLATE template0`); } finally { await c.end(); }
  return url();
}

module.exports = { HOME, DIR, PORT, USER, DBNAME, ensure, init, start, stop, running, url, password, binDir, exe, run };
