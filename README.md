# Hệ thống Báo giá nông sản – TTKN An Giang

Phiên bản chạy thật của bản web Báo giá nông sản (BRD v1.3): máy chủ Node.js, cơ sở dữ liệu **PostgreSQL**, đăng nhập, phân quyền theo vai trò, nhiều người dùng cùng lúc.

## Chạy thử (Windows)
1. Cài **Node.js 22 trở lên** (https://nodejs.org) và **PostgreSQL 14 trở lên** (máy bạn đã có PostgreSQL 18).
2. Bấm đúp **`start.bat`**. Trình duyệt tự mở `http://localhost:8080`.
3. Đăng nhập bằng một tài khoản bên dưới, chọn phòng ban **Thông tin tuyên truyền**.

Lần chạy đầu tiên (khoảng 20 giây) hệ thống tự: cài thư viện `pg`, tạo một **PostgreSQL riêng** của dự án (cổng 5440, chỉ nghe 127.0.0.1, không đụng PostgreSQL khác trên máy), tạo cơ sở dữ liệu `baogia` và nạp dữ liệu mẫu. Dòng lệnh: `node --no-warnings server/server.js` (đổi cổng: `set PORT=9000`).

## Tài khoản dùng thử (mật khẩu chung `nongnghiep2026`)
| Tên đăng nhập | Vai trò |
|---|---|
| `an.nv.myhoahung` (hoặc SĐT `0912345678`) | Cấp Xã · Mỹ Chánh |
| `ho.huu.thuy.chauphu` | Cấp Xã · Châu Phú |
| `lam.minh.linh.anchau` | Cấp Xã · An Châu |
| `le.duc.dat.hatien` | Cấp Xã · Hà Tiên |
| `binh.tt.tinh` | Cấp Tỉnh · Quản trị nghiệp vụ (phụ trách Mỹ Chánh, Hà Tiên) |
| `khoa.pm.tinh` | Cấp Tỉnh (phụ trách Châu Phú) |
| `quan.lm.tw` | Cấp Quốc gia (chỉ xem) |
| `admin` | Admin (tài khoản, xã, danh mục, đồng hồ hệ thống, nhật ký) |

Để thấy nhiều người cùng làm việc, mở nhiều cửa sổ **ẩn danh** (hoặc trình duyệt khác nhau), mỗi cửa sổ một tài khoản.

## Thử một vòng nghiệp vụ (khoảng 5 phút)
1. Cửa sổ 1: `lam.minh.linh.anchau` → **Nhập báo giá** → *Lấy giá kỳ trước* → *Gửi báo giá*.
2. Cửa sổ 2: `binh.tt.tinh` → **Tiến độ nhập giá**: phiếu An Châu hiện *Đã gửi* sau vài giây, không cần tải lại.
3. Cửa sổ 3: `admin` → **Đồng hồ hệ thống** → chọn *12:00*. Quay lại cửa sổ 1 và sửa giá: máy chủ từ chối vì đã qua giờ khóa.
4. Cửa sổ 2: **Kiểm duyệt & công bố** → xử lý cảnh báo (xã Châu Phú do `khoa.pm.tinh` xử lý) → *Duyệt bảng giá*.
5. Cửa sổ 1 và `quan.lm.tw`: **Bảng giá tổng hợp** thấy bảng giá đã công bố.
6. `admin` → **Nhật ký hệ thống**: ghi lại mọi thao tác ở trên.

## Vận hành
| Việc | Cách làm |
|---|---|
| Xem cơ sở dữ liệu | `xem-csdl.bat` (mở psql), hoặc pgAdmin 4 / DBeaver với thông tin kết nối ở mục dưới |
| Sao lưu | `sao-luu.bat` (pg_dump, tệp `.dump` trong `%LOCALAPPDATA%BaoGiaNongSanackups`) |
| Dừng PostgreSQL riêng | `dung-postgres.bat` (máy chủ Báo giá tự bật lại khi chạy `start.bat`) |
| Đưa dữ liệu về ban đầu | `reset-du-lieu.bat` (xóa hết, nạp lại dữ liệu mẫu) |
| Dựng lại giao diện sau khi sửa mã | `node tools/build-client.js` |
| Chạy kiểm thử | `npm test` (mỗi lần tạo một database PostgreSQL tạm rồi xóa; cần Chrome và thư viện puppeteer-core có sẵn trong `../Prototype_Mobile/tools/node_modules`): API 25 ca · trình duyệt thật 17 bước · luồng bấm nút thật 8 + 13 + 9 bước · duyệt 58 màn hình menu |

**Kết nối cơ sở dữ liệu (PostgreSQL riêng):** máy chủ `127.0.0.1` · cổng `5440` · cơ sở dữ liệu `baogia` · người dùng `bg_admin` · mật khẩu sinh ngẫu nhiên, nằm trong `%LOCALAPPDATA%BaoGiaNongSanpg-password.txt` (chạy `node tools/pg.js info` để xem đường dẫn). Dữ liệu PostgreSQL nằm ở `%LOCALAPPDATA%BaoGiaNongSanpgdata` (không nằm trong thư mục dự án vì PostgreSQL trên Windows không đọc được đường dẫn có dấu tiếng Việt). Muốn dùng PostgreSQL khác của đơn vị: đặt `DATABASE_URL=postgresql://người_dùng:mật_khẩu@máy_chủ:5432/baogia`, các bảng tự được tạo.

Biến môi trường: `DATABASE_URL` · `PORT` (mặc định 8080) · `HOST` (mặc định `127.0.0.1`; `0.0.0.0` để máy khác trong mạng nội bộ truy cập) · `BG_ADMIN_PASSWORD` (mật khẩu Admin khi nạp dữ liệu lần đầu) · `BG_DEMO_HINTS=0` (ẩn gợi ý tài khoản dùng thử trên màn đăng nhập) · `BG_PG_HOME` (thư mục dữ liệu PostgreSQL riêng, phải không có dấu) · `BG_PG_PORT` (mặc định 5440) · `PG_BIN` (thư mục bin của PostgreSQL nếu không cài ở vị trí mặc định).

## Cấu trúc thư mục
```
server/    máy chủ: server.js (HTTP, API) · auth.js (đăng nhập, phiên) · policy.js (phân quyền đọc/ghi)
           sync.js (đồng bộ) · domain.js (giờ khóa, ngày báo giá) · ticker.js (nhắc nhập giá) · db.js (PostgreSQL) · pg-local.js (PostgreSQL riêng) · seed.js
client/    sys/10_sys.js (lớp kết nối máy chủ) · dist/index.html (giao diện đã dựng, máy chủ phục vụ)
data/      seed.json (dữ liệu mẫu) · outbox.log (thư mô phỏng)
tests/     api.test.js · e2e.js · screens.js
docs/      RBAC.md (ma trận phân quyền) · API.md (API, bảng) · PO-QUYET-DINH.md (quyết định, phạm vi, rủi ro, lộ trình)
tools/     build-client.js · export-seed.js · backup.js
```
Giao diện được dựng từ mã nguồn bản web trong thư mục `Prototype_Mobile` (không sửa mã đó) cộng `client/sys/`.

## Lưu ý quan trọng
- Đây là bản **trải nghiệm** để người dùng thử hệ thống thật. Trước khi dùng cho dữ liệu thật cần đọc `docs/PO-QUYET-DINH.md` (mục Chưa làm, Rủi ro): tính toán nghiệp vụ còn ở trình duyệt, thư gửi mô phỏng, chưa có HTTPS.
- Một liên kết trên claude.ai không chạy được máy chủ. Muốn đưa lên mạng miễn phí cho khách dùng thử: xem `docs/DEPLOY-RENDER.md` (Render + Neon).
