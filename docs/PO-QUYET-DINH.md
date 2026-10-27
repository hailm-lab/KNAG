# Quyết định của nhóm (PO · Dev lead · BA lead)

## Mục tiêu bản này
Biến bản web Báo giá nông sản (prototype chạy trong trình duyệt) thành **một hệ thống chạy thật**: nhiều người dùng đăng nhập bằng tài khoản thật, dữ liệu nằm ở máy chủ và cơ sở dữ liệu, quyền được máy chủ kiểm soát. Giao diện và nghiệp vụ giữ nguyên theo BRD v1.3 để người dùng trải nghiệm đúng sản phẩm đã duyệt.

## Quyết định chính
| # | Quyết định | Lý do |
|---|---|---|
| 1 | Máy chủ Node.js + **PostgreSQL** (thư viện `pg`) | Theo yêu cầu của chủ sản phẩm; nhiều người ghi đồng thời an toàn; có công cụ quản trị sẵn (pgAdmin). Dự án tự dựng một PostgreSQL riêng ở cổng 5440 nên không đụng PostgreSQL khác trên máy; có thể trỏ sang máy chủ của đơn vị bằng `DATABASE_URL` |
| 2 | Giữ nguyên giao diện và logic nghiệp vụ của bản web; thêm lớp đồng bộ | Không viết lại ~25 màn hình đã được duyệt; rủi ro lệch nghiệp vụ thấp |
| 3 | Máy chủ giữ **quyền, giờ khóa, phiên bản, nhật ký**; tính toán nghiệp vụ nặng vẫn ở trình duyệt | Đủ để nhiều người dùng thật, phân quyền thật; chuyển tính toán sang máy chủ là giai đoạn sau |
| 4 | **Đồng hồ nghiệp vụ do máy chủ giữ**, Admin chỉnh được; mặc định cố định ở 15/10/2026 09:15 để dữ liệu mẫu có ý nghĩa; có chế độ chạy theo giờ thực | Giờ khóa 12:00 và hạn phản hồi 13:30 phải do máy chủ quyết định, không thể bị trình duyệt gian lận |
| 5 | Nhắc nhập giá và cấu hình hẹn ngày hiệu lực chạy **trên máy chủ**, id cố định theo (xã, ngày, lần) | Nhiều người mở cùng lúc không sinh nhắc trùng |
| 6 | Mỗi vai trò chỉ **nhận** dữ liệu mình được xem (Cấp Xã chỉ xã mình, Cấp TW không có họ tên, SĐT nông hộ) | BRD BR-03; ẩn trên giao diện là chưa đủ |
| 7 | Gửi thư **mô phỏng** (ghi vào `data/outbox.log`) | Bản trải nghiệm chưa có máy chủ thư |
| 8 | Mở thêm 3 tài khoản cán bộ Xã (Châu Phú, An Châu, Hà Tiên) | Thử nhiều xã cùng lúc; trong prototype 3 người này không đăng nhập được |

## Phạm vi đã làm
- Đăng nhập thật (tên đăng nhập / email / SĐT), chọn vai trò và phòng ban, đổi mật khẩu, quên mật khẩu (link 30 phút, dùng một lần), khóa tạm khi sai 5 lần, hết phiên sau 4 giờ không thao tác.
- Toàn bộ chức năng module Báo giá của 4 vai trò (Cấp Xã, Cấp Tỉnh, Cấp TW, Admin): nhập, gửi, in phiếu, lịch sử, cảnh báo, yêu cầu xác minh và phản hồi, kiểm duyệt, công bố, báo cáo, điều tra giá thành, danh mục, cấu hình, quản trị tài khoản và xã.
- Nhiều người dùng đồng thời: thay đổi của người khác tự hiện sau tối đa 3 giây; ghi chồng nhau được phát hiện và báo rõ.
- Nhật ký thao tác (Admin xem ngay trong hệ thống), sao lưu, đặt lại dữ liệu.

## Chưa làm (đề xuất giai đoạn sau, theo thứ tự ưu tiên)
1. **Chuyển tính toán nghiệp vụ sang máy chủ:** sinh cảnh báo vượt ngưỡng, dựng ảnh chụp bảng giá khi duyệt, thống kê. Hiện máy chủ chặn vượt quyền, vượt giờ khóa và hạn phản hồi, và chặn duyệt khi chưa đủ điều kiện (qua giờ khóa, hết cảnh báo, có phiếu), nhưng **không tự tính lại** số liệu.
2. **Gửi email thật** (nhắc nhập giá, link đặt lại mật khẩu) và đăng bảng giá lên website (Đợt 2 trong BRD, hiện mô phỏng).
3. **Triển khai máy chủ thật:** HTTPS, tên miền, chạy dịch vụ nền, sao lưu định kỳ tự động (hiện sao lưu thủ công bằng `sao-luu.bat`), nhiều tiến trình máy chủ phía sau bộ cân bằng tải (bộ nhớ đệm cấu hình giờ khóa hiện nằm trong từng tiến trình, chấp nhận độ trễ tối đa 1 giây).
4. **Đồng bộ danh mục ĐVHC** với danh mục dùng chung của Hệ thống Khuyến nông (xã báo giá "Mỹ Chánh" hiện chưa có trong danh mục 102 xã).
5. **Ứng dụng điện thoại (Mobile)** kết nối cùng máy chủ; BRD còn mâu thuẫn về đăng nhập PIN (mục II.2 ghi tạm bỏ, mục Đa nền tảng ghi PIN 6 số) cần chốt với khách hàng trước.
6. Các module khác của Hệ thống Khuyến nông (Trồng trọt, Chăn nuôi, Kế hoạch tài chính…) chưa nằm trong hệ thống này.

## Rủi ro đã biết
| Rủi ro | Giảm thiểu hiện tại |
|---|---|
| Trình duyệt tính sai hoặc bị sửa mã gửi số liệu không nhất quán trong phạm vi quyền của người đó | Máy chủ chặn vượt quyền, vượt giờ khóa, sửa sau khi duyệt; nhật ký ghi lại mọi thay đổi; tính toán phía máy chủ là việc ưu tiên số 1 sau bản này |
| Mật khẩu mẫu `nongnghiep2026` ai cũng biết | Đổi bằng `BG_ADMIN_PASSWORD` khi chạy lần đầu, tắt gợi ý tài khoản bằng `BG_DEMO_HINTS=0`, buộc đổi mật khẩu tài khoản mới tạo |
| Chạy HTTP không mã hóa | Mặc định chỉ nghe `127.0.0.1`; mở ra mạng nội bộ bằng `HOST=0.0.0.0` chỉ nên dùng cho thử nghiệm |
| PostgreSQL riêng chạy trong tài khoản người dùng Windows, không phải dịch vụ | Dừng/khởi động bằng `dung-postgres.bat` và `start.bat`; sao lưu bằng `sao-luu.bat`; môi trường thật nên dùng PostgreSQL của đơn vị (`DATABASE_URL`) |
