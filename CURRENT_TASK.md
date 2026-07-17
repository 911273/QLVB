# CURRENT TASK

# Feature

Database Storage Security

---

## WHY

Hiện tại người dùng có thể biết hoặc truy cập trực tiếp vào Google Drive chứa cơ sở dữ liệu.

Điều này không đáp ứng yêu cầu bảo mật lâu dài.

Hệ thống cần tách hoàn toàn người dùng khỏi vị trí lưu trữ dữ liệu.

---

## BUSINESS GOAL

Đảm bảo chỉ tài khoản Quản trị viên (Administrator) mới được phép:

- Xem vị trí Google Drive Database
- Thay đổi vị trí Google Drive Database
- Xem thông tin Folder ID
- Xem thông tin cấu hình lưu trữ

Người dùng thông thường không được biết hoặc truy cập các thông tin trên.

---

## FUNCTIONAL REQUIREMENTS

Thiết kế và triển khai cơ chế quản lý vị trí Database.

Yêu cầu:

1.

Chỉ Administrator mới được xem:

- Database Folder
- Database Folder ID
- Database Configuration

2.

Cho phép Administrator thay đổi:

- Database Folder

mà không cần sửa source code.

3.

Khi thay đổi Folder:

Hệ thống phải cập nhật cấu hình.

4.

Không làm mất dữ liệu.

5.

Không ảnh hưởng OCR.

6.

Không ảnh hưởng Search.

7.

Không ảnh hưởng Scanner.

---

## NON-FUNCTIONAL REQUIREMENTS

Không hardcode Folder ID.

Không yêu cầu sửa source để đổi Folder.

Có khả năng mở rộng nhiều Storage Provider trong tương lai.

Ưu tiên dùng cơ chế Configuration thay vì Constant.

Thiết kế dễ bảo trì.

---

## SECURITY REQUIREMENTS

Không hiển thị Folder ID cho User.

Không hiển thị Google Drive URL cho User.

Không cho phép User sửa Database Location.

Kiểm tra quyền trước mọi thao tác thay đổi cấu hình.

---

## DESIGN REQUIREMENTS

Claude phải:

- Phân tích kiến trúc hiện tại.

- Đề xuất thiết kế tối ưu.

- Chỉ sửa những module cần thiết.

- Hạn chế thay đổi API.

- Không tạo Technical Debt.

Nếu cần thay đổi kiến trúc, giải thích lý do trước khi triển khai.

---

## FILES ALLOWED

Config.gs

Storage.gs

Code.gs

(JavaScript.html nếu thật sự cần)

---

## FILES FORBIDDEN

Scanner.gs

Search.gs

Classifier.gs

OCR.gs

Stylesheet.html

Index.html (trừ khi bắt buộc)

appsscript.json

---

## SUCCESS CRITERIA

✓ Chỉ Administrator được quản lý Database Folder.

✓ Folder Database có thể thay đổi từ giao diện quản trị.

✓ Không cần sửa source code khi đổi Folder.

✓ Không ảnh hưởng dữ liệu hiện có.

✓ Không ảnh hưởng các chức năng khác.

✓ Thiết kế có khả năng mở rộng.
