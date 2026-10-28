# Ma trận phân quyền (do MÁY CHỦ thực thi)

Vai trò đang dùng do trình duyệt gửi kèm mỗi yêu cầu (`X-Role`), máy chủ **kiểm tra lại** với danh sách vai trò của tài khoản. Tài khoản chỉ có tác dụng trong phòng ban được phân quyền. Mọi từ chối trả về lý do bằng tiếng Việt và giao diện hoàn lại dữ liệu theo bản của máy chủ.

Ký hiệu: **X** = xem · **S** = sửa/thêm · **–** = không có · *(own)* = chỉ xã mình phụ trách · *(canAct)* = chỉ xã do mình phụ trách hoặc xã chưa phân công cán bộ Tỉnh

## Đọc dữ liệu (thu hẹp trước khi gửi về trình duyệt)

| Dữ liệu | Cấp Xã | Cấp Tỉnh | Cấp TW | Admin |
|---|---|---|---|---|
| Danh mục: xã ĐVHC, phòng ban, mặt hàng, nhóm hàng, bộ theo vụ, cấu hình, xã báo giá | X | X | X | X |
| Tài khoản (không bao giờ có mật khẩu) | X | X | X | X |
| Phiếu báo giá, nhắc nhập giá, đề xuất mặt hàng | X (own) | X | – | X |
| Cảnh báo biến động | X (own) | X | chỉ mã, mặt hàng, ngày, chiều, % (để đếm) | X |
| Bảng giá (đã duyệt, các phiên bản) | X (không có nhật ký) | X | X (không có nhật ký) | X |
| Đợt điều tra giá thành | – | X | X (bỏ SĐT cán bộ điều tra) | X |
| Phiếu điều tra giá thành | – | X | X, **bỏ họ tên và SĐT nông hộ** (BRD BR-03) | X |
| Nhật ký thao tác của ngày, khóa sửa, bảng từ đồng nghĩa | – | X | – | X |
| Chương trình khuyến nông (danh mục hạng mục, báo cáo tuần: Chương trình thông tin, Đào tạo huấn luyện và hợp tác) | – | X | – | X |
| Thông báo | chỉ của mình | chỉ của mình | chỉ của mình | chỉ của mình |
| Nhật ký hệ thống (`/api/audit`) | – | – | – | X |

## Ghi dữ liệu

| Dữ liệu | Cấp Xã | Cấp Tỉnh | Cấp TW | Admin |
|---|---|---|---|---|
| Phiếu báo giá | S (own), trước giờ khóa theo **đồng hồ máy chủ**, chỉ ngày báo giá, chỉ lưu nháp / gửi; **không** được đặt giá hiệu chỉnh hay loại dòng | S (canAct): hiệu chỉnh, loại dòng, nhập thay, sửa ngày, xóa; chặn khi bảng giá ngày đó đã duyệt (riêng việc **ghi thêm nhật ký của phiếu**, ví dụ nhãn "thuộc bảng giá vN" khi duyệt, được phép với phiếu mọi xã) | – | – |
| Cảnh báo biến động | Sinh mới ở trạng thái Tạm tính (own); cập nhật theo lần gửi lại; gửi phản hồi khi đang được yêu cầu xác minh (`yc → ph`) **trước hạn phản hồi 13:30** theo đồng hồ máy chủ; tự hủy cảnh báo khi sửa giá về dưới ngưỡng và gửi lại; **không** sửa được kết luận | S (canAct): yêu cầu xác minh, hiệu chỉnh, giữ nguyên, loại; chặn khi bảng giá đã duyệt | – | – |
| Bảng giá (duyệt, công bố, mở duyệt) | – | S. **Duyệt** chỉ khi đã qua giờ khóa, không còn cảnh báo chưa xử lý và có ít nhất một phiếu (máy chủ kiểm tra) | – | – |
| Đề xuất mặt hàng | Gửi mới (own) | Quản trị nghiệp vụ duyệt / từ chối | – | X |
| Mặt hàng, nhóm hàng, bộ theo vụ, cấu hình báo giá | – | S nếu là **Quản trị nghiệp vụ** | – | S |
| Xã báo giá, tài khoản, danh mục ĐVHC, phòng ban | – | – | – | S |
| Đồng hồ hệ thống (`bgSys`) | – | – | – | S |
| Đợt điều tra, phiếu điều tra, bảng từ đồng nghĩa, nhật ký | – | S | – | S |
| Khóa sửa / duyệt | – | S, chỉ khóa của chính mình | – | – |
| Chương trình khuyến nông: báo cáo tuần (`prRep`) | – | S (bản nháp); tiến độ và kinh phí phải là số không âm; **đã chốt thì không sửa**, không xóa; không đổi chương trình hoặc tuần | – | S (như Cấp Tỉnh) |
| Chương trình khuyến nông: hạng mục (`prCat`) | – | S; quy mô phải lớn hơn 0; chỉ xóa hạng mục do người dùng thêm | – | S |
| Nhật ký thao tác của ngày | **ghi thêm** | ghi thêm | – | ghi thêm (không ai sửa hoặc xóa) |
| Nhắc nhập giá | – | – | – | – (do máy chủ tự sinh) |
| Thông báo | gửi cho người khác; chỉ người nhận được đánh dấu đã đọc / xóa | như Cấp Xã | như Cấp Xã | như Cấp Xã |

## Quy tắc xuyên suốt
- **Giờ khóa, ngày báo giá, hạn phản hồi** tính theo đồng hồ máy chủ (`bgSys.clock`), không tin đồng hồ trình duyệt.
- **Phiên bản:** ghi trên bản cũ bị từ chối (`conflict`), kèm bản mới của máy chủ.
- **Quyền kiểm tra trước, xung đột sau**: người không có quyền nhận thông báo "không có quyền", không thấy thông tin gì về bản ghi.
- **Mật khẩu:** băm scrypt kèm muối riêng, lưu bảng riêng; khóa tạm 15 phút sau 5 lần sai; hết phiên sau 4 giờ không thao tác (BRD FN-AD-01.01).
