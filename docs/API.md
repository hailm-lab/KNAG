# API và cơ sở dữ liệu

## Kiến trúc
```
Trình duyệt (giao diện web đã có)  ──HTTP/JSON──►  server/server.js  ──►  PostgreSQL (cơ sở dữ liệu baogia)
   • giữ bản sao dữ liệu theo vai trò                  • xác thực, phiên (cookie HttpOnly)
   • gửi phần thay đổi (diff) lên máy chủ              • phân quyền đọc / ghi theo vai trò (policy.js)
   • hỏi thay đổi của người khác mỗi 3 giây            • giờ khóa, phiên bản, nhật ký (sync.js, domain.js)
                                                       • tác vụ theo giờ: nhắc nhập giá, cấu hình hẹn ngày (ticker.js)
```
Chỉ một thư viện ngoài: `pg` (trình điều khiển PostgreSQL). Còn lại dùng `node:http`, `node:crypto`. Giao diện được dựng từ chính mã nguồn bản web Báo giá cộng lớp kết nối `client/sys/10_sys.js` (`node tools/build-client.js`).

## Điểm cần biết khi phát triển tiếp
Quy tắc nghiệp vụ nặng (tính cảnh báo vượt ngưỡng, dựng bảng giá khi duyệt, thống kê) hiện vẫn chạy ở **trình duyệt** như bản prototype; máy chủ chịu trách nhiệm **ai được làm gì, khi nào, trên bản ghi nào, đúng phiên bản nào** và lưu bền vững. Một người dùng có tài khoản hợp lệ nhưng cố tình sửa mã trình duyệt vẫn không vượt được quyền, nhưng có thể gửi số liệu tính toán không nhất quán trong phạm vi quyền của mình. Chuyển các tính toán này sang máy chủ là việc của giai đoạn sau (xem `PO-QUYET-DINH.md`).

## Điểm cuối (endpoint)
Mọi yêu cầu `POST` phải có `X-Requested-With: bg`. Các điểm cuối cần vai trò gửi kèm `X-Role: <chỉ số vai trò>|<phòng ban>`.

| Phương thức, đường dẫn | Cần | Mô tả |
|---|---|---|
| `GET /api/health` | – | Tình trạng máy chủ, đồng hồ hệ thống |
| `GET /api/config` | – | Cấu hình hiển thị (gợi ý tài khoản dùng thử) |
| `POST /api/login` `{u, pw}` | – | Đăng nhập bằng tên đăng nhập / email / SĐT. Sai: `401` kèm `left`; khóa: `423` kèm `until` |
| `POST /api/logout` | phiên | Hủy phiên |
| `GET /api/me` | phiên | Tài khoản, danh sách phòng ban, tên xã báo giá (để chọn vai trò) |
| `POST /api/password` `{old, pw}` | phiên | Đổi mật khẩu (≥ 8 ký tự, có chữ và số) |
| `POST /api/forgot` `{email}` | – | Tạo link đặt lại (hiệu lực 30 phút, dùng một lần, 5 lần/giờ); thư được **mô phỏng**, ghi vào `data/outbox.log` |
| `POST /api/reset` `{token, pw}` | – | Đặt mật khẩu mới bằng link |
| `GET /api/state` | vai trò | Toàn bộ dữ liệu theo vai trò (đã thu hẹp) + phiên bản + con trỏ thay đổi |
| `POST /api/sync` `{ops:[{c,id,op,base,doc}]}` | vai trò | Gửi thay đổi; trả kết quả từng thay đổi: `ok`/`forbidden`/`conflict`/`invalid` kèm bản của máy chủ |
| `GET /api/changes?since=N` | vai trò | Thay đổi của người khác từ con trỏ N (đã thu hẹp theo vai trò) |
| `GET /api/audit?limit=N` | Admin | Nhật ký thao tác ghi dữ liệu |

## Bảng cơ sở dữ liệu (`server/db.js`)
| Bảng | Nội dung |
|---|---|
| `docs(c, id, json jsonb, ver, upd, by)` | Mọi bản ghi nghiệp vụ dạng tài liệu JSONB, có số phiên bản (khóa chính `c, id`); có chỉ mục theo `date`, `xa` trong JSON |
| `changes(seq bigserial, c, id, op, ver, at)` | Nhật ký thay đổi theo thứ tự, dùng cho đồng bộ gia tăng. Mọi giao dịch ghi lấy khóa tư vấn (`pg_advisory_xact_lock`) nên số thứ tự được chốt đúng thứ tự, trình duyệt không bỏ sót thay đổi |
| `credentials(user_id, salt, hash, fails, locked_until)` | Mật khẩu băm scrypt, đếm sai, khóa tạm |
| `sessions(sid, user_id, created, last_seen, ip, ua)` | Phiên (lưu băm SHA-256 của mã phiên, hết hạn sau 4 giờ không thao tác) |
| `reset_tokens`, `rate` | Link đặt lại mật khẩu, giới hạn tần suất |
| `audit(seq, at, user_id, who, level, c, id, op, summary, ip)` | Nhật ký thao tác (ai, lúc nào, thay đổi gì) |
| `meta` | Thông tin nạp dữ liệu mẫu |

**Ghi chú PostgreSQL:** JSONB sắp xếp lại khóa của đối tượng nên mọi so sánh trong `policy.js` dùng so sánh chuẩn hóa (không phụ thuộc thứ tự khóa). Ghi có kiểm tra phiên bản bằng một câu lệnh `UPDATE … WHERE ver = `, nên hai người sửa cùng lúc không bao giờ ghi đè nhau.

Các collection (`c`) trong `docs`: `users`, `xa`, `depts`, `notifs`, `bgXa`, `bgItem`, `bgGroup`, `bgSet`, `bgCfg`, `bgSys`, `bgPhieu`, `bgAlert`, `bgBoard`, `bgProp`, `bgRemind`, `bgLog`, `bgLock`, `bgSyn`, `bgRound`, `bgSrv`.
