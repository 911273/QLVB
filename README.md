# QLVB-EPU — Hệ thống Quản lý Văn bản Trường Đại học Điện lực

Ứng dụng web chạy trên nền tảng **Google Apps Script**, lưu toàn bộ dữ liệu trên **Google Drive** của bạn.
Không cần server riêng, không cần cơ sở dữ liệu ngoài, không tốn phí hạ tầng.

## Tính năng

- 📁 **Quản lý văn bản** theo **thời gian ban hành** và **loại văn bản** (Quyết định, Quy định, Quy trình, Thông báo, Công văn, Kế hoạch, Tờ trình, Báo cáo, Hướng dẫn, Biên bản, Hợp đồng, Giấy mời...).
- 🔄 **Tự động quét & cập nhật** văn bản trong folder Drive (kể cả folder con), thủ công hoặc theo lịch định kỳ.
- 🏷️ **Tự động phân loại** dựa trên tên file và nội dung; tự trích **số/ký hiệu** và **ngày ban hành**.
- 🔎 **Tìm kiếm** theo tên, số hiệu, loại, khoảng ngày và **tìm trong nội dung** văn bản.
- 🔤 **OCR** ảnh scan và PDF bằng công cụ OCR của Google. Hai mức:
  - *Mặc định*: Drive OCR (không cần cấu hình, nhưng tiếng Việt kém).
  - *Nâng cao*: **Google Cloud Vision API** — chất lượng tiếng Việt cao (giữ đúng dấu). Nhập API key trong tab **Cài đặt**. Xem hướng dẫn lấy key ngay trong app.
- 📊 Trang **tổng quan** thống kê theo loại và theo năm.

## Kiến trúc

| Thành phần | Công nghệ |
|---|---|
| Giao diện web | HTML/CSS/JS phục vụ qua `HtmlService` |
| Xử lý phía server | Google Apps Script (V8) |
| Lưu trữ file | Google Drive (folder gốc tự tạo `QLVB-EPU`) |
| Cơ sở dữ liệu (index, metadata, nội dung OCR) | Google Sheets tự tạo |
| OCR | Google Drive OCR qua Advanced Drive Service |

Mã nguồn trong thư mục [`src/`](src/):

```
src/
├── appsscript.json     # Manifest: scope, advanced service Drive v3, cấu hình web app
├── Config.gs           # Cấu hình, danh mục loại văn bản
├── Storage.gs          # Khởi tạo & thao tác Drive + Google Sheets (database)
├── Scanner.gs          # Quét Drive, phát hiện file mới/sửa, trigger tự động
├── Classifier.gs       # Tự động phân loại + trích số hiệu/ngày ban hành/trích yếu
├── Ocr.gs              # OCR ảnh/PDF & trích text từ DOC/DOCX/Google Docs
├── Search.gs           # Tìm kiếm & lọc
├── Code.gs             # doGet + các API cho giao diện
├── Index.html          # Giao diện chính
├── Stylesheet.html     # CSS
└── JavaScript.html     # JS phía client
```

---

## Cách 1 — Cài đặt thủ công (khuyến nghị, ~5 phút, không cần cài gì)

1. Mở https://script.google.com → **New project** (Dự án mới).
2. Trong project, tạo đủ các file theo đúng tên ở cột dưới rồi **copy nội dung** từ thư mục `src/` dán vào:
   - Các file mã: `Config.gs`, `Storage.gs`, `Scanner.gs`, `Classifier.gs`, `Ocr.gs`, `Search.gs`, `Code.gs`
     (Bấm **+ → Script**, đặt tên không cần đuôi `.gs`.)
   - Các file giao diện: `Index.html`, `Stylesheet.html`, `JavaScript.html`
     (Bấm **+ → HTML**, đặt tên đúng như trên.)
3. Mở **Project Settings** (biểu tượng bánh răng) → tick **“Show appsscript.json manifest file in editor”**.
   Quay lại editor, mở file `appsscript.json` và dán nội dung từ `src/appsscript.json`.
4. Bật Advanced Drive Service (nếu chưa tự bật theo manifest):
   trong editor bấm **Services (+)** bên trái → chọn **Drive API** → **Add**. (Định danh giữ là `Drive`.)
5. **Deploy**: bấm **Deploy → New deployment → Web app**.
   - *Execute as*: **Me** (chính bạn).
   - *Who has access*: **Only myself** (hoặc **Anyone within EPU** nếu Workspace cho phép, để đồng nghiệp dùng chung).
   - Bấm **Deploy**, chấp nhận cấp quyền (Authorize access) bằng tài khoản Google của bạn.
6. Mở **URL web app** hiện ra. Lần đầu, bấm **“Khởi tạo hệ thống”** để app tạo folder `QLVB-EPU` và Google Sheet cơ sở dữ liệu.
7. Vào tab **Quét & Cập nhật** → mở link folder → tải văn bản (PDF, ảnh, Word, Google Docs) lên → bấm **Quét ngay**.

> ⚠️ **Về việc “cấp thông tin tài khoản Google”:** Ứng dụng chạy **dưới chính tài khoản Google của bạn** khi bạn Deploy và bấm *Authorize*. Vì vậy **không cần** (và không nên) đưa mật khẩu cho bất kỳ ai. Bước cấp quyền ở mục 5–6 chính là “đăng nhập” an toàn theo chuẩn OAuth của Google.

---

## Cách 2 — Dùng clasp (CLI)

Yêu cầu: Node.js ≥ 18.

```bash
npm install -g @google/clasp
clasp login                      # đăng nhập Google trên trình duyệt
clasp create --type webapp --title "QLVB-EPU" --rootDir ./src
# clasp create sẽ tạo .clasp.json với scriptId. Sau đó:
clasp push                       # đẩy toàn bộ src/ lên Apps Script
clasp deploy --description "QLVB-EPU v1"
```

Mở project bằng `clasp open`, rồi làm bước Deploy → Web app như Cách 1 (mục 5–7) để lấy URL.

`.clasp.json` mẫu (được `clasp create` sinh tự động, chỉ cần thay `scriptId`):

```json
{ "scriptId": "THAY_BANG_SCRIPT_ID_CUA_BAN", "rootDir": "src" }
```

---

## Hướng dẫn sử dụng nhanh

- **Tổng quan**: xem tổng số văn bản, phân bố theo loại/năm.
- **Danh sách văn bản**: xem tất cả, lọc theo loại và từ khoá nhanh.
- **Tìm kiếm**: gõ từ khoá (tìm cả trong nội dung OCR), lọc theo loại VB và khoảng ngày ban hành.
- **Quét & Cập nhật**:
  - *Quét ngay*: chỉ xử lý file mới/đã sửa (nhanh).
  - *Quét lại toàn bộ*: OCR lại tất cả.
  - *Tự động quét định kỳ*: bật trigger theo giờ.
- **Cài đặt**: xem thông tin hệ thống; thêm/sửa **loại văn bản** và **từ khoá phân loại**.

## Ghi chú kỹ thuật

- Mỗi lần quét xử lý tối đa `SCAN_BATCH_LIMIT` (mặc định 40) file để tránh giới hạn thời gian chạy 6 phút của Apps Script. Nếu còn file chưa xử lý, app báo và bạn chỉ cần bấm **Quét ngay** lần nữa.
- OCR PDF của Google xử lý tốt nhất với các trang đầu; PDF rất nhiều trang nên tách nhỏ.
- Nội dung lưu trong 1 ô Sheets giới hạn ~50.000 ký tự; app cắt còn 45.000 ký tự để an toàn.
- Ngôn ngữ OCR mặc định `vi` (Tiếng Việt) — đổi trong `Config.gs` (`OCR_LANGUAGE`).
- Quyền truy cập web app: sửa trong `appsscript.json` (`webapp.access`) hoặc khi Deploy.

## Bảo mật & quyền riêng tư

- Toàn bộ dữ liệu nằm trong Google Drive/Sheets của **chính tài khoản bạn deploy**.
- App không gửi dữ liệu ra ngoài Google.
- Các scope OAuth yêu cầu: Drive, Docs, Sheets, quản lý trigger (`script.scriptapp`).
