/**
 * Ocr.gs
 * Trích xuất nội dung văn bản, dùng công cụ OCR có sẵn của Google
 * (Google Drive OCR thông qua Advanced Drive Service - chuyển ảnh/PDF sang Google Docs).
 */

/**
 * Lấy nội dung text của 1 file bất kỳ.
 *  - Google Docs: đọc trực tiếp.
 *  - DOCX/DOC: convert sang Google Docs rồi đọc.
 *  - PDF/ảnh: OCR bằng Google Drive.
 * Trả về { text: String, status: 'ok'|'skip'|'error' }.
 */
function extractContent(fileId, mimeType) {
  try {
    if (mimeType === SUPPORTED_MIME.GDOC) {
      return { text: DocumentApp.openById(fileId).getBody().getText(), status: 'ok' };
    }
    if (mimeType === SUPPORTED_MIME.DOCX || mimeType === SUPPORTED_MIME.DOC) {
      return { text: convertToDocAndRead_(fileId, mimeType, null), status: 'ok' };
    }
    if (OCR_MIME_TYPES.indexOf(mimeType) !== -1) {
      var size = 0;
      try { size = DriveApp.getFileById(fileId).getSize(); } catch (e) { size = 0; }

      // Ưu tiên OCR nâng cao Vision (chất lượng tiếng Việt cao) nếu đã cấu hình API key.
      if (hasVisionKey_() && size <= VISION_MAX_BYTES) {
        try {
          var vtext = ocrWithVision_(fileId, mimeType);
          if (vtext && vtext.trim()) return { text: vtext, status: 'ok-vision' };
        } catch (ve) {
          Logger.log('Vision OCR fallback for ' + fileId + ': ' + ve);
          // rơi xuống Drive OCR bên dưới
        }
      }

      // Bỏ qua OCR nếu file quá lớn để tránh treo/timeout; vẫn lập chỉ mục theo tên file.
      if (size > MAX_OCR_BYTES) {
        return { text: '', status: 'skip-large' };
      }
      return { text: ocrWithGoogle_(fileId), status: 'ok' };
    }
    return { text: '', status: 'skip' };
  } catch (e) {
    Logger.log('extractContent error for ' + fileId + ': ' + e);
    return { text: '', status: 'error' };
  }
}

/**
 * OCR file ảnh/PDF bằng Google Drive: tạo bản sao dưới dạng Google Docs với ocrLanguage,
 * đọc text rồi xoá bản tạm.
 */
function ocrWithGoogle_(fileId) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var resource = {
    name: '[OCR-TEMP] ' + file.getName(),
    mimeType: SUPPORTED_MIME.GDOC
  };
  var created = Drive.Files.create(resource, blob, {
    ocrLanguage: OCR_LANGUAGE,
    fields: 'id'
  });
  var text = '';
  try {
    text = DocumentApp.openById(created.id).getBody().getText();
  } finally {
    // xoá bản Docs tạm để không rác Drive
    try { Drive.Files.remove(created.id); }
    catch (e) {
      try { DriveApp.getFileById(created.id).setTrashed(true); } catch (e2) {}
    }
  }
  return text;
}

/**
 * Convert DOC/DOCX sang Google Docs tạm để đọc text.
 */
function convertToDocAndRead_(fileId, mimeType, unused) {
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var resource = {
    name: '[CONV-TEMP] ' + file.getName(),
    mimeType: SUPPORTED_MIME.GDOC
  };
  var created = Drive.Files.create(resource, blob, { fields: 'id' });
  var text = '';
  try {
    text = DocumentApp.openById(created.id).getBody().getText();
  } finally {
    try { Drive.Files.remove(created.id); }
    catch (e) {
      try { DriveApp.getFileById(created.id).setTrashed(true); } catch (e2) {}
    }
  }
  return text;
}

/**
 * OCR lại 1 file theo yêu cầu từ giao diện: đặt lại về hàng đợi và OCR ngay 1 bước
 * (với PDF nhiều trang sẽ OCR cụm trang đầu; các trang còn lại do hàng đợi nền OCR tiếp).
 */
function reOcrDoc(fileId) {
  var current = getDocDetailFast_(fileId);
  if (!current) throw new Error('Không tìm thấy văn bản trong CSDL.');
  var existing = getExistingIndex_();

  // Đặt lại nội dung & tiến độ để OCR lại từ đầu.
  current.content = '';
  current.ocrProgress = '';
  current.ocrStatus = 'pending';

  var step = ocrOneStep_(current, ocrBudgetRemaining_());
  if (step && !step.skip) {
    current.content = step.content;
    current.ocrStatus = step.status;
    current.ocrProgress = step.progress || '';
    if (step.pages) ocrConsume_(step.pages);
    if (step.done && (step.status === 'ok' || step.status === 'ok-vision')) {
      finalizeDocAfterOcr_(current);
    }
  }
  current.scannedAt = new Date().toISOString();
  upsertDoc_(current, existing);
  writeLog_('OCR lại', 1, current.fileName);
  return current;
}
