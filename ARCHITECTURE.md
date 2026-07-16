# QLVB Architecture

## Mục tiêu

QLVB là hệ thống quản lý văn bản chạy trên Google Apps Script.

Dữ liệu chính lưu trên:

- Google Drive
- Google Sheets

Người dùng truy cập qua Web App.

---

# Kiến trúc

Browser

↓

Index.html

↓

JavaScript.html

↓

google.script.run

↓

Code.gs

↓

Business Modules

↓

Google Services

↓

Google Drive / Sheets

---

# Module

## Code.gs

Vai trò

- Entry Point

- doGet()

- API Router

Không chứa business logic.

---

## Scanner.gs

Vai trò

- Quét Google Drive

- Lấy metadata

- Không OCR

---

## Ocr.gs

Vai trò

OCR tài liệu.

Không cập nhật UI.

---

## Classifier.gs

Vai trò

Phân loại văn bản.

Không đọc Google Sheets trực tiếp.

---

## Search.gs

Vai trò

Tìm kiếm.

Không cập nhật dữ liệu.

---

## Storage.gs

Vai trò

CRUD dữ liệu.

Chỉ module này làm việc với Google Sheets.

---

## Config.gs

Hằng số.

ID

Folder

Sheet

Tên cột

---

# Dependency

Index

↓

JavaScript

↓

Code

↓

Search

↓

Storage

↓

Google Sheets

Không được gọi ngược.

Ví dụ:

Storage

×

JavaScript

Storage

×

Search

---

# Quy tắc

Business logic

Không nằm trong UI.

UI

Không truy cập SpreadsheetApp.

SpreadsheetApp

Chỉ dùng trong Storage.
