'use strict';
/* Chương trình khuyến nông trên hệ thống thật: hai cán bộ Tỉnh cùng làm; Cấp Xã không thấy; số liệu đi qua máy chủ, không bị từ chối ngầm.
   Chạy:  node tests/flows3.js */
const harness = require('./helpers');

(async () => {
  const h = await harness('flows3'); const { assert, sleep } = h;
  try {
    console.log('Chương trình khuyến nông (thông tin; đào tạo huấn luyện và hợp tác)');
    const khoa = await h.open('Tỉnh Khoa'); const binh = await h.open('Tỉnh Bình'); const cp = await h.open('Châu Phú');
    await h.login(khoa, 'khoa.pm.tinh'); await h.login(binh, 'binh.tt.tinh'); await h.login(cp, 'ho.huu.thuy.chauphu');

    await h.go(khoa, 'pr-dt'); await sleep(500);
    assert.strictEqual(await khoa.p.evaluate(() => DB.all('prCat').length), 25, 'dữ liệu do máy chủ nạp: 25 hạng mục'); assert.ok(await khoa.p.evaluate(() => !!document.querySelector('.prt table')), 'bảng hiển thị');
    assert.ok(await khoa.p.evaluate(() => !!document.querySelector('[data-act="pr-add"]')), 'có nút Thêm hạng mục'); h.ok('Cấp Tỉnh mở Đào tạo huấn luyện và hợp tác: 25 hạng mục từ máy chủ, bảng hiển thị');

    await khoa.p.evaluate(() => PR.state('dt').week = 44); await h.go(khoa, 'pr-dt'); await h.type(khoa, 't_dt04', '2'); await h.type(khoa, 'k_dt04', '40.000.000'); await sleep(300);
    await h.clickSel(khoa, '[data-act="pr-save"]'); await sleep(1200); await h.noRejects(khoa, 'lưu nháp');
    h.ok('Cán bộ Khoa nhập tuần 44 (2 lớp, 40.000.000 đ) và lưu nháp, máy chủ chấp nhận');

    await sleep(3800); await h.go(binh, 'pr-dt'); await binh.p.evaluate(() => PR.state('dt').week = 44); await h.go(binh, 'pr-dt');
    const seen = await binh.p.evaluate(() => { const r = PR.reps('dt').find((x) => x.week === 44); return r.rows.dt04 && r.rows.dt04.t; }); assert.strictEqual(seen, 2, 'Bình thấy số của Khoa'); h.ok('Cán bộ Bình thấy ngay số liệu của Khoa sau vài giây (đồng bộ qua máy chủ)');
    assert.strictEqual(await binh.p.evaluate(() => document.querySelector('[data-f="t_dt04"]').value), '2');

    await h.type(binh, 't_dt04', '3'); await h.clickSel(binh, '[data-act="pr-save"]'); await sleep(1000); await h.noRejects(binh, 'sửa số tuần 44');
    await h.clickSel(binh, '[data-act="pr-close"]'); await sleep(400); await h.confirm(binh); await sleep(900); await h.noRejects(binh, 'chốt báo cáo');
    assert.strictEqual(await binh.p.evaluate(() => PR.reps('dt').find((x) => x.week === 44).st), 'sent'); h.ok('Cán bộ Bình chốt báo cáo tuần 44');

    await sleep(3800); const khoaSt = await khoa.p.evaluate(() => PR.reps('dt').find((x) => x.week === 44).st); assert.strictEqual(khoaSt, 'sent'); assert.ok(await khoa.p.evaluate(() => !document.querySelector('[data-f="t_dt04"]')), 'đã chốt: không còn ô nhập');
    h.ok('Cán bộ Khoa thấy báo cáo đã chốt, không còn ô nhập');
    await h.clickSel(khoa, '[data-act="pr-new"]'); await sleep(1200); await h.noRejects(khoa, 'tạo báo cáo tuần 45');
    assert.strictEqual(await khoa.p.evaluate(() => document.querySelector('#pr-lk-dt04').innerText), '13', 'tuần 45: lũy kế đầu kỳ = 10 + 3'); h.ok('Tạo báo cáo tuần 45: lũy kế cộng dồn 10 + 3 = 13');

    await h.go(khoa, 'pr-tt'); await h.clickSel(khoa, '.pradd [data-act="pr-add"]'); await sleep(500);
    await h.type(khoa, 'ten', 'Hội nghị tổng kết'); await h.type(khoa, 'dvt', 'cuộc'); await h.type(khoa, 'quyMo', '5'); await h.clickText(khoa, /^Thêm$/, '.ovl'); await sleep(1200); await h.noRejects(khoa, 'thêm hạng mục');
    assert.ok(await khoa.p.evaluate(() => PR.cats('tt').some((c) => c.ten === 'Hội nghị tổng kết (cuộc)')), 'đã thêm'); await sleep(3800);
    assert.ok(await binh.p.evaluate(() => DB.all('prCat').some((c) => c.ten === 'Hội nghị tổng kết (cuộc)')), 'Bình nhận hạng mục mới'); h.ok('Thêm hạng mục: người kia nhận được sau vài giây');

    await sleep(500); assert.strictEqual(await cp.p.evaluate(() => DB.all('prCat').length + DB.all('prRep').length), 0, 'Cấp Xã không nhận dữ liệu'); h.ok('Cán bộ Cấp Xã (Châu Phú) không nhận dữ liệu chương trình');
    await h.finish();
  } catch (e) { await h.finish(e); }
})();
