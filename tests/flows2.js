'use strict';
/* Luồng của Cấp Tỉnh và Admin trên hệ thống thật, kiểm tra không có thay đổi hợp lệ nào bị máy chủ từ chối ngầm:
   yêu cầu xác minh → Xã đề xuất giá → hiệu chỉnh · nhập thay · duyệt → mở duyệt → duyệt lại · Admin tạo tài khoản, đổi cán bộ Xã · Quản trị nghiệp vụ đổi cấu hình.
   Chạy:  node tests/flows2.js */
const harness = require('./helpers');

(async () => {
  const h = await harness('flows2'); const { assert, sleep } = h;
  try {
    console.log('Luồng Cấp Tỉnh và Admin');
    const khoa = await h.open('Tỉnh Khoa'); const binh = await h.open('Tỉnh Bình'); const cp = await h.open('Châu Phú'); const adm = await h.open('Admin');
    await h.login(khoa, 'khoa.pm.tinh'); await h.login(binh, 'binh.tt.tinh'); await h.login(cp, 'ho.huu.thuy.chauphu'); await h.login(adm, 'admin');

    /* 1. Yêu cầu xác minh qua hộp thoại pop-up */
    await h.go(khoa, 'bg-alerts'); await sleep(400);
    const tam = await khoa.p.evaluate(() => DB.all('bgAlert').find((a) => a.st === 'tam' && a.xa === 'bx02')); assert.ok(tam, 'có cảnh báo Tạm tính của Châu Phú');
    await h.clickSel(khoa, '.bgab [data-act="bgt-areq"]'); assert.ok(await khoa.p.evaluate(() => !!document.querySelector('.ovl textarea')), 'hộp thoại pop-up'); await h.clickText(khoa, /^Gửi$/, '.ovl'); await sleep(1200);
    await h.noRejects(khoa, 'yêu cầu xác minh');
    assert.strictEqual(await khoa.p.evaluate((id) => DB.get('bgAlert', id).st, tam.id), 'yc'); h.ok('Cấp Tỉnh bấm "Yêu cầu xác minh" trong hộp thoại: cảnh báo chuyển sang Đã yêu cầu xác minh');

    /* 2. Cấp Xã nhận thông báo và đề xuất giá đúng */
    await sleep(3800);
    const got = await cp.p.evaluate(() => DB.all('notifs').filter((n) => /xác minh/i.test(n.title)).length); assert.ok(got >= 1, 'Châu Phú nhận thông báo'); h.ok('Cán bộ Châu Phú nhận được thông báo yêu cầu xác minh (không cần tải lại)');
    await h.go(cp, 'bg-verify-detail', { id: tam.id });
    await cp.p.evaluate(() => { Form.set('kind', 'dexuat'); Form.set('lo', 55000); Form.set('hi', 58000); Form.set('text', 'Giá đúng theo thương lái tại chợ đầu mối.'); }); await cp.p.evaluate(() => refresh()); await sleep(300);
    await h.clickSel(cp, '[data-act="bgx-reply"]'); await sleep(1200); await h.noRejects(cp, 'phản hồi đề xuất giá');
    assert.strictEqual(await cp.p.evaluate((id) => DB.get('bgAlert', id).st, tam.id), 'ph'); h.ok('Châu Phú phản hồi "đề xuất giá đúng" qua giao diện');

    /* 3. Qua giờ khóa 12:00, Cấp Tỉnh hiệu chỉnh theo đề xuất */
    await h.setClock(adm, '2026-10-15T12:05'); await sleep(3800); await h.go(khoa, 'bg-edit', { xa: 'bx02', date: '2026-10-15', focus: tam.item, alert: tam.id }); await sleep(400);
    await h.type(khoa, 'lo_' + tam.item, '55000'); await h.type(khoa, 'hi_' + tam.item, '58000');
    const hasReason = await khoa.p.evaluate(() => !!document.querySelector('[data-f="reason"]')); if (hasReason) await h.type(khoa, 'reason', 'Theo giá xã đề xuất');
    await h.clickSel(khoa, '[data-act="bgt-editsave"]'); await h.confirm(khoa); await sleep(1500);
    const st3 = await khoa.p.evaluate((id) => DB.get('bgAlert', id).st, tam.id); await h.noRejects(khoa, 'hiệu chỉnh giá');
    assert.ok(['dahc', 'giu', 'loai'].includes(st3), 'cảnh báo đã được chốt: ' + st3); h.ok(`Cấp Tỉnh hiệu chỉnh giá theo đề xuất của xã, cảnh báo chuyển sang trạng thái "${st3}"`);

    /* 4. Nhập thay cho xã An Châu không nộp (sau 12:00) */
    await h.go(binh, 'bg-proxy', { xa: 'bx03', date: '2026-10-15' }); await sleep(500);
    await h.clickSel(binh, '[data-act="bgt-pxprev"]'); await sleep(300); await h.type(binh, 'reason', 'Xã báo qua Zalo lúc 12:10 do mất mạng.');
    await h.clickSel(binh, '[data-act="bgt-pxsave"][data-done="1"]'); await sleep(1500); await h.noRejects(binh, 'nhập thay');
    const late = await binh.p.evaluate(() => { const p = BG.phieu('bx03', '2026-10-15'); return p && p.st; }); assert.strictEqual(late, 'late'); h.ok('Cấp Tỉnh nhập thay cho An Châu: phiếu có nhãn Nộp muộn, được máy chủ chấp nhận');

    /* 5. Xử lý cảnh báo còn lại, duyệt, mở duyệt, duyệt lại */
    for (const [u, label] of [[khoa, 'Khoa'], [binh, 'Bình']]) {
      await h.go(u, 'bg-alerts'); await sleep(400); let guard = 0;
      while (guard++ < 8) { const cnt = await u.p.evaluate(() => document.querySelectorAll('.bgab [data-act="bgt-ares"][data-type="giu"]').length); if (!cnt) break; await h.clickSel(u, '.bgab [data-act="bgt-ares"][data-type="giu"]'); await h.type(u, 'text', `Giữ nguyên (${label})`); await h.clickText(u, /^Lưu$/, '.ovl'); await sleep(1200); }
      await h.noRejects(u, `${label} xử lý cảnh báo`);
    }
    await sleep(3800); assert.strictEqual(await binh.p.evaluate(() => BG.unhandled(bgToday()).length), 0);
    await h.go(binh, 'bg-review'); await h.clickSel(binh, '[data-act="bgt-approve"]'); await h.confirm(binh); await sleep(1800); await h.noRejects(binh, 'duyệt lần 1');
    assert.strictEqual(await binh.p.evaluate(() => BG.boardPeek(bgToday()).st), 'approved'); h.ok('Duyệt bảng giá lần 1 (đã có phiếu nhập thay và giá hiệu chỉnh)');
    await h.go(binh, 'bg-review'); await h.clickSel(binh, '[data-act="bgt-reopen"]'); await h.type(binh, 'reason', 'Bổ sung hiệu chỉnh theo phản ánh của Cấp TW.'); await h.clickText(binh, /Xác nhận mở duyệt/, '.ovl'); await sleep(1500); await h.noRejects(binh, 'mở duyệt');
    assert.strictEqual(await binh.p.evaluate(() => BG.boardPeek(bgToday()).st), 'reopen'); h.ok('Cấp Tỉnh mở duyệt bảng giá kèm lý do');
    await binh.p.evaluate(() => { const p = BG.phieu('bx01', '2026-10-15'); p.items.jasmine.adj = { lo: 8500, hi: 9100 }; BG.entLog(p, 'Hiệu chỉnh khi mở duyệt'); BG.touch('2026-10-15'); saveState(); }); await sleep(1500); await h.noRejects(binh, 'hiệu chỉnh khi mở duyệt');
    await h.go(binh, 'bg-review'); await h.clickSel(binh, '[data-act="bgt-approve"]'); await h.confirm(binh); await sleep(1800); await h.noRejects(binh, 'duyệt lại');
    assert.strictEqual(await binh.p.evaluate(() => BG.boardPeek(bgToday()).ver), 2); h.ok('Duyệt lại sau khi mở duyệt: bảng giá lên phiên bản v2');

    /* 6. Admin: tạo tài khoản, đổi cán bộ Xã phụ trách */
    await adm.p.evaluate(() => { DB.insert('users', { id: 'u_moi', ten: 'Cán bộ Xã mới', username: 'moi.canbo', email: 'moi@khuyennong.demo', phone: '0933111222', pw: 'KhoiTao2026', active: true, roles: [{ level: 'xa', depts: ['tttt'], unit: 'TTKN tỉnh An Giang', bgXa: [] }] }); BG.assignCb('bx03', 'u_moi', bgToday()); saveState(); });
    await sleep(1800); await h.noRejects(adm, 'Admin tạo tài khoản và đổi cán bộ');
    const loginNew = await adm.p.evaluate(() => fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'bg' }, body: JSON.stringify({ u: 'moi.canbo', pw: 'KhoiTao2026' }) }).then((r) => r.status)); assert.strictEqual(loginNew, 200); h.ok('Admin tạo tài khoản mới và đổi cán bộ Xã phụ trách An Châu: người mới đăng nhập được');
    await sleep(3800); const gotXa = await binh.p.evaluate(() => (DB.get('bgXa', 'bx03') || {}).cb); assert.strictEqual(gotXa, 'u_moi'); h.ok('Cấp Tỉnh thấy cán bộ phụ trách mới sau vài giây');

    /* 7. Quản trị nghiệp vụ đổi cấu hình; cán bộ Tỉnh thường thì không */
    await binh.p.evaluate(() => { bgCfg().thDefault = 25; DB.insert('bgItem', { id: 'moi_item', ten: 'Mặt hàng thử nghiệm', group: DB.all('bgGroup')[0].id, loai: 'dp', dvt: 'kg', quycach: '', noiBan: '', from: BG.nextEff(), xas: [] }); saveState(); }); await sleep(1500); await h.noRejects(binh, 'Quản trị nghiệp vụ đổi cấu hình và thêm mặt hàng');
    h.ok('Quản trị nghiệp vụ đổi ngưỡng cảnh báo và thêm mặt hàng: được chấp nhận');
    await khoa.p.evaluate(() => { bgCfg().thDefault = 5; saveState(); }); await sleep(1500); const rj = await h.rejects(khoa);
    assert.ok(rj.length >= 1 && rj[0].c === 'bgCfg', 'cán bộ Tỉnh thường bị từ chối: ' + JSON.stringify(rj)); h.ok('Cán bộ Tỉnh không phải Quản trị nghiệp vụ đổi cấu hình: bị từ chối, giao diện hoàn lại giá trị cũ');
    assert.strictEqual(await khoa.p.evaluate(() => bgCfg().thDefault), 25); await h.finish();
  } catch (e) { await h.finish(e); }
})();
