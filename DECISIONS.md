# Architectural Decisions

## ADR-001

Storage.gs

là nơi duy nhất

được đọc ghi Google Sheets.

---

ADR-002

Business logic

không nằm trong HTML.

---

ADR-003

Không dùng jQuery.

---

ADR-004

Không dùng eval().

---

ADR-005

Không sửa appsscript.json

nếu không được yêu cầu.

---

ADR-006

Không hardcode Folder ID.
# ADR-010

Database Location

Không được hardcode trong source.

Phải lưu dưới dạng cấu hình.

---

# ADR-011

Mọi thao tác thay đổi Database Location

phải kiểm tra quyền Administrator.

---

# ADR-012

Các module Scanner, Search, OCR

không được biết Folder ID.

Chỉ Storage Layer được phép truy cập cấu hình lưu trữ.
