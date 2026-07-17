# CURRENT TASK

## Feature

Content-based Search & Document Discovery (Nâng cao tìm kiếm & khám phá tài liệu)

---

## WHY

Hệ thống hiện tìm kiếm theo từ khóa/substring đơn giản và sinh quá nhiều từ khóa
theo tần suất. Cần chuyển sang tìm kiếm theo NỘI DUNG tài liệu: mỗi tài liệu được
phân tích để rút cụm từ khóa chất lượng, chủ đề, lĩnh vực, khái niệm, đối tượng,
căn cứ pháp lý; và gợi ý tài liệu liên quan chính xác hơn theo nhiều yếu tố.

Ràng buộc nền tảng: chạy trong Google Apps Script, KHÔNG gọi API ngoài
(không sửa appsscript.json/OAuth, không tốn quota) — dùng thuật toán từ vựng +
cấu trúc (RAKE key phrases + trích khái niệm/đối tượng/căn cứ pháp lý + TF-IDF đa yếu tố).

---

## Requirements

1. Key phrases: mỗi tài liệu chỉ 3–5 cụm giá trị nhất; ưu tiên cụm danh từ/thuật ngữ;
   loại từ dừng/cụm vô nghĩa; khử trùng lặp/gần giống; không thuần theo tần suất.
2. Phân tích nội dung: chủ đề chính, lĩnh vực, khái niệm quan trọng, đối tượng,
   căn cứ pháp lý/tiêu chuẩn (nếu có). Lưu để tái sử dụng.
3. Tài liệu liên quan: 5–10, kết hợp chủ đề + nội dung + từ khóa + tiêu đề + danh mục + metadata.
4. Kiến trúc: module hóa, dễ mở rộng/bảo trì, không duplicate, không phá chức năng cũ.
5. Hiệu năng: chỉ phân tích khi OCR xong hoặc khi cập nhật; KHÔNG tính lại mỗi lần tìm kiếm; lưu kết quả.
6. Ưu tiên: chính xác > mở rộng > bảo trì > hiệu năng; không chọn giải pháp nhanh nhưng khó mở rộng.

---

## Files Allowed

- Config.gs        (hằng số: tham số RAKE, từ điển lĩnh vực, trọng số liên quan)
- Storage.gs       (thêm cột ANALYSIS ở cuối, hook cập nhật, migration backfill)
- Keywords.gs      (RAKE key phrases 3–5, khử trùng lặp)
- Analyzer.gs      (MỚI: phân tích nội dung + tài liệu liên quan đa yếu tố)
- OcrQueue.gs      (hook phân tích khi OCR xong)
- Scanner.gs       (hook phân tích khi quét văn bản đọc được text)
- Search.gs        (xếp hạng theo nội dung: keyphrase/concept/field/legalRef)
- Code.gs          (getDetail trả hồ sơ phân tích cho UI)
- JavaScript.html  (hiển thị chủ đề/lĩnh vực/key phrases ở cửa sổ chi tiết)
- Index.html       (nếu cần khung hiển thị tối thiểu)

## Files Forbidden

- Stylesheet.html  (không sửa CSS)
- Classifier.gs    (giữ nguyên bộ phân loại loại VB)
- appsscript.json  (không đổi OAuth/scope)

---

## Data Model change

- Thêm 1 cột "Phân tích" (ANALYSIS) ở CUỐI sheet VanBan (không đổi tên/thứ tự cột cũ).
- Nội dung: JSON { topic, field, concepts[], entities[], legalRefs[] }.
- Cột "Từ khóa" (KEYWORDS) lưu 3–5 key phrases dạng "cụm|trọng số".

## Success Criteria

✓ Mỗi tài liệu có 3–5 key phrases chất lượng, không trùng lặp.
✓ Có hồ sơ phân tích (chủ đề/lĩnh vực/khái niệm/đối tượng/căn cứ pháp lý) lưu lại.
✓ Tài liệu liên quan 5–10, xếp hạng đa yếu tố.
✓ Phân tích chỉ chạy khi OCR xong / cập nhật, không chạy khi tìm kiếm.
✓ Tương thích ngược CSDL cũ (migration backfill), không phá chức năng hiện có.
