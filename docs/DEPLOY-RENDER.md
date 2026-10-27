# Đưa hệ thống lên mạng miễn phí: Render (máy chủ) + Neon (PostgreSQL)

Kết quả: một link `https://….onrender.com` công khai, có HTTPS, đăng nhập thật, dữ liệu lưu ở Neon.

## 1. Tạo cơ sở dữ liệu Neon (3 phút)
1. Vào https://neon.com, đăng ký (đăng nhập bằng GitHub/Google), tạo Project, chọn vùng **Singapore** (gần Việt Nam nhất).
2. Ở trang Project bấm **Connect**, copy **Connection string** dạng
   `postgresql://người_dùng:mật_khẩu@ep-xxxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. Không cần tạo bảng: máy chủ tự tạo bảng và nạp dữ liệu mẫu ở lần chạy đầu.

## 2. Đưa mã lên GitHub
1. Tạo kho mới trên https://github.com/new (chọn **Private**).
2. Đưa **nội dung thư mục `BaoGia_System`** lên kho đó (file `package.json` phải nằm ở gốc kho). Thư mục `node_modules` sẽ tự bị bỏ qua nhờ `.gitignore`. Có thể dùng GitHub Desktop hoặc dòng lệnh:
   ```
   cd BaoGia_System
   git init && git add . && git commit -m "Bao gia nong san"
   git branch -M main
   git remote add origin https://github.com/<tên>/<kho>.git
   git push -u origin main
   ```
3. Phải có sẵn `client/dist/index.html` trong kho (đã dựng sẵn, đừng xóa).

## 3. Tạo máy chủ trên Render
1. Vào https://render.com, đăng nhập bằng GitHub, bấm **New → Blueprint**, chọn kho vừa tạo (Render đọc file `render.yaml`).
   Hoặc **New → Web Service**: Runtime *Node*, Build `npm install --omit=dev`, Start `npm start`, Instance *Free*.
2. Điền biến môi trường:
   | Biến | Giá trị |
   |---|---|
   | `DATABASE_URL` | chuỗi kết nối Neon ở bước 1 |
   | `PGSSLMODE` | `require` |
   | `BG_ADMIN_PASSWORD` | mật khẩu mạnh cho tài khoản `admin` (chỉ có tác dụng ở lần nạp dữ liệu đầu tiên) |
   | `BG_DEMO_HINTS` | `1` để màn đăng nhập gợi ý các tài khoản dùng thử, `0` để ẩn |
3. Bấm **Deploy**. Khoảng 2–3 phút sau Render cấp link. Mở `https://<tên>.onrender.com/api/health` thấy `"ok":true` là xong, rồi vào trang chủ đăng nhập.

## 4. Gửi cho khách
- Tài khoản dùng thử và vòng nghiệp vụ thử: xem `README.md`. Mật khẩu các tài khoản mẫu vẫn là `nongnghiep2026` (chỉ `admin` đổi theo `BG_ADMIN_PASSWORD`). Nếu gửi link rộng rãi, nên đổi mật khẩu từng tài khoản bằng chức năng Đổi mật khẩu hoặc đặt `BG_DEMO_HINTS=0` và chỉ gửi tài khoản cho đúng người.
- Đặt lại dữ liệu về ban đầu: trong Render mở **Shell** chạy `npm run reset` (cần gói trả phí), hoặc xóa dữ liệu bằng SQL Editor của Neon: `TRUNCATE docs, changes, credentials, sessions, reset_tokens, rate, audit, meta RESTART IDENTITY;` rồi **Manual Deploy → Restart**, máy chủ tự nạp lại dữ liệu mẫu.

## Điều cần biết về gói miễn phí
- **Render Free ngủ sau ~15 phút không có người truy cập.** Người mở đầu tiên chờ 30–60 giây. Bộ nhắc nhập giá chạy trong máy chủ nên không chạy lúc máy chủ ngủ.
- **Đừng dùng dịch vụ "ping giữ thức"**: giữ máy chủ thức liên tục sẽ làm Neon không ngủ được và hết hạn mức giờ chạy miễn phí trong tháng.
- Neon Free tự ngủ khi không dùng, truy vấn đầu tiên chậm khoảng 1 giây. Dung lượng miễn phí 0,5 GB, thừa cho bản trải nghiệm.
- Giờ nghiệp vụ mặc định là đồng hồ cố định do Admin chỉnh (15/10/2026 09:15). Nếu đổi sang "chạy theo giờ thực" thì máy chủ Render dùng giờ UTC (chậm hơn Việt Nam 7 giờ).
- Thư (quên mật khẩu, nhắc) vẫn mô phỏng; không gửi email thật.
- Đây là bản **trải nghiệm**, không nhập dữ liệu thật của khách (xem `PO-QUYET-DINH.md`, mục Chưa làm và Rủi ro).
- Điều kiện các gói miễn phí có thể thay đổi: xem lại trang giá của Render và Neon trước khi đăng ký.
