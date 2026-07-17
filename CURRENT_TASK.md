# CURRENT TASK

## Feature

Metadata nâng cao: từ khóa thủ công, quản lý Lĩnh vực, trạng thái xử lý suy diễn,
hiệu lực & quan hệ văn bản; bỏ Độ mật/Độ khẩn.

---

## Requirements

1. Từ khóa: cho phép thêm / sửa / xóa key phrase của từng văn bản (thủ công),
   không bị pipeline OCR ghi đè; có nút quay lại "tự động".
2. Lĩnh vực: quản lý danh mục Lĩnh vực trong Cài đặt (CRUD như Loại VB);
   cho chọn/sửa lĩnh vực thủ công cho văn bản; lọc theo lĩnh vực.
3. Bỏ Độ mật, Độ khẩn khỏi toàn bộ UI (giữ cột cũ trong sheet, ngừng dùng).
4. Trạng thái xử lý SUY DIỄN từ OCR + cờ đã kiểm tra:
   Chưa OCR / Đang OCR / Lỗi OCR / File quá lớn / Chưa kiểm tra / Đã kiểm tra;
   dùng làm bộ lọc tìm kiếm. Có nút "Đánh dấu đã kiểm tra".
5. Hiệu lực & quan hệ văn bản: Còn hiệu lực / Hết hiệu lực / Chưa xác định;
   liên kết "văn bản thay thế", "bị thay thế bởi", "văn bản liên quan".
   Đặt A thay thế B ⇒ tự cập nhật 2 chiều (B = Hết hiệu lực, B bị thay thế bởi A).

---

## Data Model change (thêm cột ở CUỐI sheet VanBan)

- FIELD (Lĩnh vực)      — tên lĩnh vực hiệu lực (tự nhận hoặc sửa tay).
- VALIDITY (Hiệu lực)   — Còn hiệu lực / Hết hiệu lực / Chưa xác định.
- RELATIONS (Liên kết)  — JSON { replaces:[], replacedBy:[], related:[] } (fileId).
- Cột SECURITY/URGENCY giữ nguyên nhưng ngừng dùng (không xóa/đổi thứ tự).
- Cờ sửa tay từ khóa/lĩnh vực lưu trong ANALYSIS JSON (kwManual/fieldManual).

## Files Allowed

Config.gs, Storage.gs, Keywords.gs, Analyzer.gs, Search.gs, Export.gs, Code.gs,
JavaScript.html, Index.html

## Files Forbidden

Stylesheet.html (không sửa CSS), Classifier.gs, appsscript.json

## Success Criteria

✓ Thêm/sửa/xóa từ khóa thủ công, không bị OCR ghi đè, có nút về tự động.
✓ Quản lý danh mục Lĩnh vực + chọn lĩnh vực cho VB + lọc theo lĩnh vực.
✓ Không còn Độ mật/Độ khẩn trên UI.
✓ Trạng thái xử lý suy diễn + lọc được.
✓ Hiệu lực + liên kết văn bản (thay thế/bị thay thế/liên quan) 2 chiều.
✓ Tương thích ngược CSDL cũ; không phá "Sửa liên tục"/"Áp dụng hàng loạt".
