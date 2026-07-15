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
 * OCR lại 1 file theo yêu cầu từ giao diện (chạy lại OCR & cập nhật DB).
 */
function reOcrDoc(fileId) {
  var file = DriveApp.getFileById(fileId);
  var mimeType = file.getMimeType();
  var res = extractContent(fileId, mimeType);
  var docs = readAllDocs();
  var existing = getExistingIndex_();
  var current = null;
  for (var i = 0; i < docs.length; i++) {
    if (docs[i].fileId === fileId) { current = docs[i]; break; }
  }
  if (!current) throw new Error('Không tìm thấy văn bản trong CSDL.');

  current.content = res.text;
  current.ocrStatus = res.status;
  current.title = extractTitle(current.fileName, res.text) || current.title;
  if (!current.docNumber) current.docNumber = extractDocNumber(current.fileName, res.text);
  current.scannedAt = new Date().toISOString();
  upsertDoc_(current, existing);
  writeLog_('OCR lại', 1, current.fileName);
  return current;
}
