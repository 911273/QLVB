# CURRENT TASK

## Feature

Administrator Database Folder Settings

---

## WHY

Hiện tại vị trí thư mục Google Drive của cơ sở dữ liệu được cấu hình cố định.

Khi cần chuyển sang thư mục khác phải sửa source code.

Mục tiêu là cho phép Administrator thay đổi vị trí thư mục mà không cần chỉnh sửa mã nguồn.

---

## Business Requirements

Chỉ tài khoản Administrator được phép:

- Xem cấu hình thư mục cơ sở dữ liệu.
- Thay đổi thư mục cơ sở dữ liệu.
- Lưu cấu hình mới.

Người dùng thông thường:

- Không nhìn thấy chức năng này.
- Không được biết Folder ID.
- Không được biết URL Google Drive.

---

## Functional Requirements

Thêm mục "Database Storage" trong trang quản trị.

Administrator có thể:

- Dán URL Google Drive Folder.
- Hoặc nhập trực tiếp Folder ID.

Hệ thống phải:

- Tự trích xuất Folder ID nếu người dùng nhập URL.
- Kiểm tra Folder có tồn tại.
- Kiểm tra ứng dụng có quyền truy cập Folder.
- Lưu cấu hình khi hợp lệ.
- Hiển thị thông báo lỗi khi không hợp lệ.

Sau khi lưu:

Toàn bộ chức năng Scanner, OCR, Search và Storage phải sử dụng Folder mới.

Không cần khởi động lại ứng dụng.

---

## Validation

Chấp nhận:

https://drive.google.com/drive/folders/...

hoặc

Folder ID.

Không chấp nhận:

- URL không hợp lệ.
- Folder không tồn tại.
- Folder không có quyền truy cập.

---

## Files Allowed

Config.gs

Storage.gs

Code.gs

JavaScript.html (Settings)

---

## Files Forbidden

Scanner.gs

Search.gs

Classifier.gs

Stylesheet.html

---

## Success Criteria

✓ Administrator có thể đổi Database Folder.

✓ Không cần sửa source code.

✓ Người dùng thường không nhìn thấy chức năng này.

✓ Hệ thống tiếp tục hoạt động với Folder mới.
