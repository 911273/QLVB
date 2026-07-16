# CLAUDE.md

# QLVB - Google Apps Script Web App

Bạn là Software Engineer chính của dự án này.

## Mục tiêu

Phát triển ứng dụng Google Apps Script quản lý văn bản.

Yêu tiên:

- Chính xác
- Dễ bảo trì
- Ít thay đổi ngoài phạm vi yêu cầu
- Tiết kiệm quota Apps Script
- Không tạo technical debt

---

# NGUYÊN TẮC LÀM VIỆC

Mỗi lần nhận yêu cầu:

1. Đọc file:

CURRENT_TASK.md

2. Chỉ mở các file được CURRENT_TASK.md chỉ định.

3. KHÔNG tự quét toàn bộ repository.

4. Nếu cần thêm context:

=> Hỏi người dùng.

Không tự search toàn project.

---

# KHÔNG ĐƯỢC

Không được:

- Refactor toàn project.
- Đổi kiến trúc.
- Đổi tên hàm public.
- Đổi cấu trúc Google Sheets.
- Đổi appsscript.json.
- Đổi quyền OAuth.
- Đổi HTML layout nếu không được yêu cầu.

---

# CẤU TRÚC

src/

Code.gs

Config.gs

Storage.gs

Scanner.gs

Classifier.gs

Search.gs

Ocr.gs

JavaScript.html

Stylesheet.html

Index.html

---

# MODULE

Code.gs

Entry point

doGet()

Menu

Storage.gs

Đọc ghi Google Drive

Google Sheets

Không chứa UI

Scanner.gs

Quét thư mục

Drive API

Classifier.gs

AI

Phân loại văn bản

Ocr.gs

OCR

Search.gs

Tìm kiếm

Index.html

UI

JavaScript.html

Frontend

Stylesheet.html

CSS

---

# QUY TẮC

Backend:

- Không truy cập Spreadsheet nhiều lần liên tiếp.
- Batch Read.
- Batch Write.

Không:

for (...) {

SpreadsheetApp....

}

Nếu có thể.

---

Không duplicate code.

Ưu tiên:

helper function

---

Không tạo global variable.

Trừ Config.

---

Không dùng eval().

---

Không dùng hardcode ID.

Dùng Config.

---

Mọi function public

phải có JSDoc.

---

# UI

Không sửa CSS nếu task không yêu cầu.

Không sửa HTML nếu task backend.

---

# LOG

Mọi lỗi

Logger.log()

hoặc LoggerEx nếu có.

Không swallow exception.

---

# OUTPUT

Sau khi hoàn thành:

1.

Liệt kê file đã sửa.

2.

Giải thích ngắn.

3.

Commit message.

4.

Không viết thêm.

---

# NẾU THIẾU THÔNG TIN

Không đoán.

Hỏi người dùng.
