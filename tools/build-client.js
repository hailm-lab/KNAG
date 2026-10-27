'use strict';
// Dựng giao diện web của hệ thống: dùng nguyên mã nguồn bản web Báo giá (Prototype_Mobile/src + web) cộng lớp kết nối máy chủ (client/sys).
// Kết quả: client/dist/index.html (một tệp, máy chủ phục vụ trực tiếp). Chạy:  node tools/build-client.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'Prototype_Mobile');
const SYS = path.join(__dirname, '..', 'client', 'sys');
const OUT = path.join(__dirname, '..', 'client', 'dist');
const list = (dir) => fs.readdirSync(dir).sort().filter((f) => /\.(css|js)$/.test(f)).map((f) => [dir, f]);

const srcFiles = list(path.join(ROOT, 'src')).filter(([, f]) => f !== '90_clean_seed.js' && !/_demoonly\.js$/.test(f));
const webFiles = list(path.join(ROOT, 'web'));
const sysFiles = list(SYS);
const all = srcFiles.concat(webFiles, sysFiles);

const css = all.filter(([, f]) => f.endsWith('.css')).map(([d, f]) => `/* ${path.basename(d)}/${f} */\n` + fs.readFileSync(path.join(d, f), 'utf8')).join('\n');
let js = all.filter(([, f]) => f.endsWith('.js')).map(([d, f]) => `/* ===== ${path.basename(d)}/${f} ===== */\n` + fs.readFileSync(path.join(d, f), 'utf8')).join('\n;\n');

// Biến đổi nhỏ khi dựng (không sửa mã nguồn prototype): menu Đồng hồ chỉ Admin thấy
const demoBtn = "${Session.dept() === 'tttt' ? `<button data-act=\"nav\" data-s=\"bg-demo\">${icon('clock', 16)} Đồng hồ báo giá (demo)</button>` : ''}";
if (!js.includes(demoBtn)) throw new Error('Không tìm thấy nút Đồng hồ demo để thay');
js = js.replace(demoBtn, "${BG.isAdmin() ? `<button data-act=\"nav\" data-s=\"bg-demo\">${icon('clock', 16)} Đồng hồ hệ thống</button>` : ''}");
const demoSummary = 'Tài khoản dùng thử (mật khẩu nongnghiep2026)';
if (!js.includes(demoSummary)) throw new Error('Không tìm thấy mục tài khoản dùng thử');
js = js.replace(demoSummary, 'Tài khoản dùng thử của bản trải nghiệm (mật khẩu nongnghiep2026)');

const adir = path.join(ROOT, 'src', 'assets'); const uri = {};
fs.readdirSync(adir).filter((f) => /\.(png|jpe?g|webp|svg)$/i.test(f)).forEach((f) => { const m = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml' }[f.split('.').pop().toLowerCase()]; uri[f.replace(/\.[^.]+$/, '')] = `data:${m};base64,` + fs.readFileSync(path.join(adir, f)).toString('base64'); });
const wdir = path.join(ROOT, 'web', 'assets');
if (fs.existsSync(wdir)) fs.readdirSync(wdir).filter((f) => /\.jpe?g$/i.test(f)).forEach((f) => { uri[f.replace(/\.[^.]+$/, '')] = 'data:image/jpeg;base64,' + fs.readFileSync(path.join(wdir, f)).toString('base64'); });

let shell = fs.readFileSync(path.join(ROOT, 'web', 'shell_web.html'), 'utf8').replace('<!--__FAVICON__-->', uri.logo_emblem ? `<link rel="icon" href="${uri.logo_emblem}">` : '');
shell = shell.replace(/<title>[^<]*<\/title>/, '<title>Khuyến nông số – Báo giá nông sản</title>');
const out = shell.replace('/*__CSS__*/', () => css).replace('/*__JS__*/', () => `const ASSETS = ${JSON.stringify(uri)};\n` + js.replace(/<\/script/gi, '<\\/script'));
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, 'index.html'), out, 'utf8');
console.log('Đã dựng client/dist/index.html', (out.length / 1024).toFixed(0) + ' KB');
