/* ==========================================================================
   10_sys.js — Lớp kết nối MÁY CHỦ cho bản web Báo giá (bản "hệ thống").
   Thay thế phần lưu trữ trong trình duyệt của bản prototype:
   - Không còn dữ liệu mẫu trong trình duyệt: mọi dữ liệu do máy chủ giữ, lấy theo vai trò sau khi đăng nhập.
   - Mỗi lần ứng dụng ghi (saveState) → tính phần thay đổi so với lần đồng bộ trước và gửi lên máy chủ (/api/sync).
     Máy chủ kiểm tra quyền, giờ khóa, phiên bản; thay đổi bị từ chối sẽ được hoàn lại bằng bản của máy chủ kèm thông báo.
   - Định kỳ hỏi máy chủ thay đổi của người khác (/api/changes) để màn hình luôn mới.
   ========================================================================== */
'use strict';

const Sys = {
  role: null,                 // 'chỉ số vai trò|phòng ban' gửi kèm mọi yêu cầu
  vers: {}, snap: {}, cursor: 0,
  busy: false, again: false, polling: false, offline: false, dirtyUI: false, timer: null,
  cfg: { demoHints: true },
  COLS: ['xa', 'depts', 'users', 'notifs', 'bgPhieu', 'bgAlert', 'bgBoard', 'bgProp', 'bgRemind', 'bgLog', 'bgLock', 'bgSyn', 'bgRound', 'bgSrv', 'bgItem', 'bgGroup', 'bgSet', 'bgCfg', 'bgXa', 'bgSys'],
};

/* ---------------- Gọi API ---------------- */
Sys.api = async function (method, url, body) {
  let r;
  try {
    r = await fetch(url, { method, credentials: 'same-origin', headers: Object.assign({ 'Content-Type': 'application/json', 'X-Requested-With': 'bg' }, Sys.role ? { 'X-Role': Sys.role } : {}), body: body ? JSON.stringify(body) : undefined });
  } catch (e) { const err = new Error('Không kết nối được máy chủ'); err.net = true; throw err; }
  let j = null; try { j = await r.json(); } catch (e) { /* không phải JSON */ }
  if (r.status === 401 && Sys.role) Sys.expired();
  if (!r.ok) { const err = new Error((j && j.msg) || ('Lỗi máy chủ (' + r.status + ')')); err.status = r.status; err.body = j; throw err; }
  return j;
};

Sys.net = function (off) {
  if (off && !Sys.offline) { Sys.offline = true; ui.toast('Mất kết nối máy chủ. Thay đổi của bạn được giữ và sẽ tự gửi lại khi có mạng.', 'warn', 6000); }
  if (!off && Sys.offline) { Sys.offline = false; ui.toast('Đã kết nối lại máy chủ.', 'ok'); }
};

/* ---------------- Trạng thái ---------------- */
function loadState() {      // thay bản gốc: không đọc IndexedDB, không sinh dữ liệu mẫu
  App.state = { ver: 1, dataVer: 'system', db: {}, session: null, offline: false, outbox: [], seededAt: nowISO() };
  return Promise.resolve();
}
function seedState() { return { ver: 1, dataVer: 'system', db: {}, session: null, offline: false, outbox: [], seededAt: nowISO() }; }
function resetDemo() { /* bản hệ thống: dữ liệu do máy chủ giữ, không đặt lại từ trình duyệt */ }
function saveState() { clearTimeout(App._saveT); App._saveT = setTimeout(() => Sys.push(), 250); }

Sys.index = function () { App._ix = {}; };

Sys.takeSnapshot = function () {
  Sys.snap = {};
  Sys.COLS.forEach((c) => { Sys.snap[c] = {}; (App.state.db[c] || []).forEach((d) => { Sys.snap[c][d.id] = JSON.stringify(d); }); });
};

/** Tải toàn bộ dữ liệu theo vai trò đang chọn */
Sys.loadAll = async function () {
  const s = await Sys.api('GET', '/api/state');
  App.state.db = s.db; Sys.vers = s.vers; Sys.cursor = s.cursor; Sys.index(); Sys.takeSnapshot();
};

/** Phần thay đổi so với lần đồng bộ trước */
Sys.diff = function () {
  const ops = []; const sent = {};
  Sys.COLS.forEach((c) => {
    const arr = App.state.db[c] || []; const sn = Sys.snap[c] || (Sys.snap[c] = {}); const seen = new Set();
    arr.forEach((d) => {
      if (!d || d.id == null) return; seen.add(d.id); const js = JSON.stringify(d);
      if (sn[d.id] !== js) { ops.push({ c, id: d.id, op: 'put', base: (Sys.vers[c] || {})[d.id] || 0, doc: d }); sent[c + '|' + d.id] = js; }
    });
    Object.keys(sn).forEach((id) => { if (!seen.has(id)) { ops.push({ c, id, op: 'del', base: (Sys.vers[c] || {})[id] || 0 }); sent[c + '|' + id] = null; } });
  });
  return { ops, sent };
};

Sys.setDoc = function (c, doc, ver) {
  const arr = DB.all(c); const i = arr.findIndex((x) => x.id === doc.id);
  if (i >= 0) arr[i] = doc; else arr.push(doc);
  (Sys.vers[c] || (Sys.vers[c] = {}))[doc.id] = ver; (Sys.snap[c] || (Sys.snap[c] = {}))[doc.id] = JSON.stringify(doc);
};
Sys.dropDoc = function (c, id) {
  const arr = DB.all(c); const i = arr.findIndex((x) => x.id === id); if (i >= 0) arr.splice(i, 1);
  if (Sys.vers[c]) delete Sys.vers[c][id]; if (Sys.snap[c]) delete Sys.snap[c][id];
};

/** Gửi thay đổi lên máy chủ */
Sys.push = async function () {
  if (!Sys.role || !App.state.session) return;
  if (Sys.busy) { Sys.again = true; return; }
  const { ops, sent } = Sys.diff(); if (!ops.length) return;
  Sys.busy = true; let reload = false;
  try {
    const r = await Sys.api('POST', '/api/sync', { ops }); Sys.net(false);
    const msgs = [];
    r.results.forEach((x) => {
      const c = x.c; const id = x.id;
      if (x.ok) {
        const op = ops.find((o) => o.c === c && o.id === id);
        if (op && op.op === 'del') { if (Sys.vers[c]) delete Sys.vers[c][id]; if (Sys.snap[c]) delete Sys.snap[c][id]; }
        else {
          (Sys.vers[c] || (Sys.vers[c] = {}))[id] = x.ver; (Sys.snap[c] || (Sys.snap[c] = {}))[id] = sent[c + '|' + id];
          if (c === 'users') { const d = DB.get('users', id); if (d && d.pw) { delete d.pw; Sys.snap[c][id] = JSON.stringify(d); } }   // mật khẩu chỉ ở máy chủ
        }
        return;
      }
      msgs.push(x.msg || 'Thay đổi bị từ chối.'); (window.__sysRejects || (window.__sysRejects = [])).push({ c, id, code: x.code, msg: x.msg });   // để kiểm thử phát hiện thao tác hợp lệ bị máy chủ từ chối
      if (x.doc) Sys.setDoc(c, x.doc, x.ver); else if (x.gone) Sys.dropDoc(c, id); else reload = true;
    });
    Sys.cursor = Math.max(Sys.cursor, 0);
    if (msgs.length) { Sys.index(); ui.toast([...new Set(msgs)][0] + (msgs.length > 1 ? ` (+${msgs.length - 1} thay đổi khác bị từ chối)` : ''), 'bad', 6000); Sys.dirtyUI = true; }
  } catch (e) {
    if (e.net) { Sys.net(true); setTimeout(() => saveState(), 5000); }
    else if (e.status !== 401) ui.toast(e.message, 'bad', 5000);
  } finally {
    Sys.busy = false;
    if (reload) { try { await Sys.loadAll(); Sys.dirtyUI = true; } catch (e) { /* thử lại ở lần sau */ } }
    if (Sys.again) { Sys.again = false; saveState(); }
    Sys.maybeRefresh();
  }
};

/** Nhận thay đổi của người khác */
Sys.poll = async function () {
  if (!Sys.role || !App.state.session || Sys.busy || Sys.polling || document.hidden) return;
  Sys.polling = true;
  try {
    const ch = await Sys.api('GET', '/api/changes?since=' + Sys.cursor); Sys.net(false);
    let applied = 0;
    ch.put.forEach((x) => {
      if ((Sys.vers[x.c] || {})[x.id] === x.ver) return;
      const cur = DB.get(x.c, x.id); if (cur && Sys.snap[x.c] && JSON.stringify(cur) !== Sys.snap[x.c][x.id]) return;    // đang có sửa chưa gửi: để xung đột xử lý khi gửi
      Sys.setDoc(x.c, x.doc, x.ver); applied++;
    });
    ch.del.forEach((x) => { if (DB.get(x.c, x.id)) { Sys.dropDoc(x.c, x.id); applied++; } });
    Sys.cursor = ch.cursor;
    if (applied) { Sys.index(); Sys.dirtyUI = true; }
    if (ch.more) setTimeout(() => Sys.poll(), 200);
  } catch (e) { if (e.net) Sys.net(true); } finally { Sys.polling = false; Sys.maybeRefresh(); }
};

Sys.maybeRefresh = function () {
  if (!Sys.dirtyUI || !App.state || !App.state.session) return;
  const ae = document.activeElement; const typing = ae && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName) && App.el && App.el.contains(ae);
  if (typing || (ui._ov && ui._ov.length)) return;
  Sys.dirtyUI = false; refresh();
};

Sys.startPolling = function () { Sys.stopPolling(); Sys.timer = setInterval(() => Sys.poll(), 3000); };
Sys.stopPolling = function () { if (Sys.timer) clearInterval(Sys.timer); Sys.timer = null; };
document.addEventListener('visibilitychange', () => { if (!document.hidden) Sys.poll(); });

Sys.expired = function () {
  if (!App.state || !App.state.session) return;
  Sys.stopPolling(); Sys.role = null; App.state.session = null; App.tmp = {};
  ui.toast('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại.', 'warn', 6000); Form.start('login', { u: '', pw: '', remember: false }); nav.reset('login');
};

/* ---------------- Đăng nhập / vai trò / đăng xuất ---------------- */
Actions['do-login'] = async function () {
  const u = String(Form.v.u || '').trim(); const pw = String(Form.v.pw || '');
  if (!u || !pw) { App.tmp.loginErr = 'Nhập email, số điện thoại hoặc tên đăng nhập và mật khẩu.'; refresh(); return; }
  App.tmp.loginErr = null; App.tmp.loginLock = null;
  try {
    const r = await Sys.api('POST', '/api/login', { u, pw });
    const me = await Sys.api('GET', '/api/me');
    App.state.db.users = [me.user]; App.state.db.depts = me.depts; App.state.db.bgXa = me.bgXa;
    Sys.index(); doLogin(me.user, Form.v.remember);
  } catch (e) {
    if (e.net) App.tmp.loginErr = 'Không kết nối được máy chủ. Kiểm tra mạng rồi thử lại.';
    else if (e.status === 423) { App.tmp.loginLock = (e.body && e.body.until) || null; App.tmp.loginErr = null; }
    else if (e.status === 401 && e.body && e.body.left != null) App.tmp.loginErr = `Email/số điện thoại hoặc mật khẩu không đúng. Còn <b>${e.body.left}</b> lần thử trước khi tài khoản bị khóa tạm 15 phút.`;
    else App.tmp.loginErr = esc(e.message);
    refresh();
  }
};

function startSession(userId, roleIdx, dept) {
  Sys.role = roleIdx + '|' + dept;
  ui.busy('Đang tải dữ liệu…', async () => {
    try {
      await Sys.loadAll();
      App.state.session = { userId, roleIdx, dept, at: nowISO(), lastSync: nowISO() };
      App.tmp = { tab: null }; Sys.dirtyUI = false; Sys.startPolling(); nav.home();
    } catch (e) { Sys.role = null; ui.toast(e.message, 'bad', 5000); nav.reset('login'); }
  }, 50);
}

Actions.logout = function () {
  ui.confirm('Đăng xuất?', 'Phiên làm việc sẽ kết thúc trên trình duyệt này.', async () => {
    try { await Sys.push(); await Sys.api('POST', '/api/logout'); } catch (e) { /* vẫn đăng xuất phía trình duyệt */ }
    Sys.stopPolling(); Sys.role = null; App.state = { ver: 1, dataVer: 'system', db: {}, session: null, offline: false, outbox: [], seededAt: nowISO() }; Sys.index(); App.tmp = {};
    Form.start('login', { u: '', pw: '', remember: false }); nav.reset('login');
  }, { okLabel: 'Đăng xuất', ic: 'logout' });
};

/* Đổi mật khẩu: kiểm tra ở máy chủ */
Actions['wpw-save'] = async function () {
  const fields = [{ name: 'old', label: 'Mật khẩu hiện tại', type: 'password', required: true }, { name: 'n1', label: 'Mật khẩu mới', type: 'text', required: true }, { name: 'n2', label: 'Nhập lại mật khẩu mới', type: 'text', required: true }];
  const ok = Form.validate(fields, { n1: (v) => (v && (v.length < 8 || !/\d/.test(v) || !/[a-zA-Z]/.test(v)) ? 'Tối thiểu 8 ký tự, gồm chữ và số' : ''), n2: (v, a) => (v && v !== a.n1 ? 'Mật khẩu nhập lại chưa khớp' : '') });
  if (!ok) { refresh(); return; }
  try { await Sys.api('POST', '/api/password', { old: Form.v.old, pw: Form.v.n1 }); Form.start('_'); ui.toast('Đã đổi mật khẩu', 'ok'); nav.back(); }
  catch (e) { Form.err.old = e.message; refresh(); }
};

/* Quên mật khẩu: thư gửi được mô phỏng, nội dung ghi vào data/outbox.log của máy chủ */
Actions['forgot-pw'] = function () {
  Form.start('forgot', { email: '' });
  const fields = [{ name: 'email', label: 'Email đã đăng ký', type: 'email', required: true }];
  const id = ui.sheet({ title: 'Quên mật khẩu', body: `<p class="muted t13" style="margin:0">Nhập email đã đăng ký. Hệ thống gửi link đặt lại mật khẩu (hiệu lực 30 phút, dùng một lần). <b>Bản trải nghiệm không có máy chủ thư:</b> link được ghi vào tệp data/outbox.log trên máy chủ.</p>${ui.fields(fields)}`,
    actions: [{ label: 'Hủy', cls: 'ghost' }, { label: 'Gửi link đặt lại', onClick: () => {
      if (!Form.validate(fields)) { ui.updateSheet(id, { body: `<p class="muted t13" style="margin:0">Nhập email đã đăng ký.</p>${ui.fields(fields)}` }); return false; }
      Sys.api('POST', '/api/forgot', { email: Form.v.email }).then(() => ui.dialog({ title: 'Đã gửi yêu cầu', text: 'Nếu email có trong hệ thống, link đặt lại mật khẩu đã được tạo (hiệu lực 30 phút, dùng một lần).', ic: 'mail', noCancel: true, okLabel: 'Đã hiểu' })).catch((e) => ui.toast(e.message, 'bad', 5000));
      return true; } }] });
};

/* Màn đặt lại mật khẩu mở từ link #/reset/<mã> */
Screens['sys-reset'] = {
  render(p) {
    const fields = [{ name: 'n1', label: 'Mật khẩu mới', type: 'password', required: true, help: 'Tối thiểu 8 ký tự, có chữ và số' }, { name: 'n2', label: 'Nhập lại mật khẩu mới', type: 'password', required: true }];
    if (!Form.is('sysreset')) Form.start('sysreset', { n1: '', n2: '' });
    return `<div class="scr" style="align-items:center;justify-content:center;padding:24px"><div class="card" style="max-width:420px;width:100%"><h2 style="margin:0 0 6px">Đặt lại mật khẩu</h2><p class="muted t13" style="margin:0 0 12px">Nhập mật khẩu mới cho tài khoản của bạn.</p><div class="form" style="gap:14px">${ui.fields(fields)}</div>${App.tmp.resetErr ? `<div class="note bad" style="margin-top:12px">${icon('alert', 18)}<div class="grow">${esc(App.tmp.resetErr)}</div></div>` : ''}<button class="btn block" style="margin-top:14px" data-act="sys-reset-go" data-t="${esc(p.token)}">Lưu mật khẩu</button><button class="link" style="margin-top:8px" data-act="sys-to-login">Về trang đăng nhập</button></div></div>`;
  },
};
Actions['sys-reset-go'] = async function (el, d) {
  const v = Form.v; App.tmp.resetErr = null;
  if (!v.n1 || v.n1 !== v.n2) { App.tmp.resetErr = 'Mật khẩu nhập lại chưa khớp.'; refresh(); return; }
  try { await Sys.api('POST', '/api/reset', { token: d.t, pw: v.n1 }); history.replaceState(null, '', location.pathname); Form.start('login', { u: '', pw: '', remember: false }); ui.toast('Đã đặt lại mật khẩu. Hãy đăng nhập bằng mật khẩu mới.', 'ok', 6000); nav.reset('login'); }
  catch (e) { App.tmp.resetErr = e.message; refresh(); }
};
Actions['sys-to-login'] = function () { history.replaceState(null, '', location.pathname); Form.start('login', { u: '', pw: '', remember: false }); nav.reset('login'); };

/* ---------------- Tắt các phần chỉ có ở bản prototype ---------------- */
function bgTick() { /* nhắc nhập giá và áp dụng cấu hình hẹn ngày do máy chủ đảm nhiệm */ }
Demo.render = function () { const d = document.getElementById('demo'); if (d) d.remove(); };
BG.applyPending = function () { };
BG.applyAdminPending = function () { };
BG.remindCfg = function () { return bgCfg(); };
BG.lockFreeMine = function () { if (!App.state || !App.state.db.bgLock) return; const me = BG.me(); DB.where('bgLock', (l) => l.user === me).forEach((l) => DB.remove('bgLock', l.id)); };

/* Đồng hồ nghiệp vụ do máy chủ giữ (chỉ Admin được chỉnh): dùng để kiểm thử các mốc khóa 12:00 và hạn phản hồi 13:30 */
Screens['bg-demo'] = {
  render() {
    if (!BG.isAdmin()) return ui.screen({ header: ui.header({ title: 'Đồng hồ hệ thống' }), body: ui.note('Chỉ Admin được chỉnh đồng hồ hệ thống.', 'grey', 'lock'), nav: true });
    const s = bgSys(); const presets = ['07:25', '09:15', '11:59', '12:00', '13:29', '13:30', '14:00'];
    const mode = s.mode === 'real';
    const body = `${ui.note('Đồng hồ này quyết định ngày báo giá, giờ khóa nhập 12:00, hạn phản hồi 13:30 và lúc gửi nhắc. Máy chủ giữ giờ này cho mọi người dùng; người dùng thường không đổi được.', 'grey')}
      ${ui.section('Chế độ', `<div class="row" style="gap:8px"><button class="btn ${mode ? 'outline' : ''} grow" data-act="sys-clock-mode" data-m="fixed">Cố định (kiểm thử)</button><button class="btn ${mode ? '' : 'outline'} grow" data-act="sys-clock-mode" data-m="real">Chạy theo giờ thực</button></div><p class="small muted" style="margin:8px 0 0">${mode ? 'Máy chủ cập nhật đồng hồ theo giờ thực của máy chủ mỗi phút.' : 'Giờ đứng yên cho tới khi Admin chỉnh. Dữ liệu mẫu kết thúc ở ngày 15/10/2026.'}</p>`)}
      ${ui.section('Giờ hiện tại của hệ thống', `<p style="margin:0 0 8px"><b>${esc(fmt.dt(s.clock))}</b> (${esc(fmt.dow(s.clock))})</p>${mode ? '' : `<div class="row" style="flex-wrap:wrap;gap:6px">${presets.map((t) => `<button class="btn outline sm" data-act="bgd-clock" data-t="${bgToday()}T${t}">${t}</button>`).join('')}</div>
        <div class="row" style="gap:8px;margin-top:8px"><button class="btn outline sm grow" data-act="bgd-clock" data-t="${BG.nextDay(bgToday())}T07:25">Sang ngày báo giá kế tiếp 07:25</button><button class="btn outline sm grow" data-act="bgd-clock" data-t="${BG.lastDay(addDays(bgToday(), -1))}T09:15">Về ngày báo giá trước</button></div>`}`)}`;
    return ui.screen({ header: ui.header({ title: 'Đồng hồ hệ thống' }), body, nav: true });
  },
};
Actions['sys-clock-mode'] = function (el, d) { bgSys().mode = d.m; saveState(); ui.toast(d.m === 'real' ? 'Đồng hồ chạy theo giờ thực' : 'Đồng hồ cố định', 'ok'); refresh(); };

/* ---------------- Khởi động ---------------- */
Boot.push(() => {
  Form.start('login', { u: '', pw: '', remember: false });
  fetch('/api/config', { credentials: 'same-origin' }).then((r) => r.json()).then((c) => { Sys.cfg = c || Sys.cfg; if (!Sys.cfg.demoHints) document.body.classList.add('no-demo-hints'); }).catch(() => { });
  const m = /^#\/reset\/([a-f0-9]+)$/.exec(location.hash || '');
  if (m) setTimeout(() => nav.reset('sys-reset', { token: m[1] }), 0);
});

/* ---------------- Admin: Nhật ký hệ thống (ai đã thay đổi gì, lúc nào) ---------------- */
{
  const wmAdmin = WM.admin;
  WM.admin = function () {
    const m = wmAdmin(); const last = m[m.length - 1];
    if (last && !last.items.some((i) => i.s === 'sys-audit')) last.items.push({ s: 'sys-audit', t: 'Nhật ký hệ thống' }, { s: 'bg-demo', t: 'Đồng hồ hệ thống' });
    return m;
  };
}
Screens['sys-audit'] = {
  tab: 'dl',
  render() {
    const rows = App.tmp.sysAudit;
    if (!rows && !App.tmp.sysAuditLoading) { App.tmp.sysAuditLoading = true; Sys.api('GET', '/api/audit?limit=300').then((r) => { App.tmp.sysAudit = r.rows; App.tmp.sysAuditLoading = false; refresh(); }).catch((e) => { App.tmp.sysAuditLoading = false; ui.toast(e.message, 'bad', 5000); }); }
    const OPS = { create: 'Thêm', update: 'Sửa', delete: 'Xóa', login: 'Đăng nhập', lock: 'Khóa tạm', password: 'Đổi mật khẩu', 'reset-request': 'Yêu cầu đặt lại mật khẩu' };
    const tr = (rows || []).map((a) => `<tr><td style="white-space:nowrap">${esc(fmt.dt(toISO(new Date(a.at))))}</td><td>${esc(a.who || 'Hệ thống')}</td><td>${esc(a.level || '')}</td><td>${esc(OPS[a.op] || a.op)}</td><td class="small">${esc(a.summary || '')}</td></tr>`);
    return ui.screen({
      header: ui.rootHeader({ title: 'Nhật ký hệ thống', sub: '<span class="muted">300 thao tác gần nhất · chỉ Admin xem</span>', actions: `<button class="btn outline" data-act="sys-audit-reload">${icon('history', 18)}Tải lại</button>` }),
      body: W.card('', W.table([{ h: 'Thời gian' }, { h: 'Người thực hiện' }, { h: 'Cấp' }, { h: 'Thao tác' }, { h: 'Nội dung' }], tr, { empty: rows ? 'Chưa có thao tác nào' : 'Đang tải…' })),
    });
  },
};
Actions['sys-audit-reload'] = function () { App.tmp.sysAudit = null; refresh(); };
