/**
 * Vision.gs
 * OCR nâng cao dùng Google Cloud Vision API (DOCUMENT_TEXT_DETECTION),
 * cho chất lượng nhận dạng tiếng Việt cao hơn nhiều so với OCR tích hợp của Drive.
 *
 * Cần: 1 API key của Google Cloud Vision (bật Vision API + billing trên GCP).
 * Nhập API key ở màn hình Cài đặt. Nếu chưa nhập, hệ thống tự dùng Drive OCR.
 */

function getVisionApiKey_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_VISION_API_KEY) || '';
}

function hasVisionKey_() {
  return !!getVisionApiKey_();
}

function setVisionApiKey(key) {
  var props = PropertiesService.getScriptProperties();
  if (key && key.trim()) {
    props.setProperty(PROP_VISION_API_KEY, key.trim());
  } else {
    props.deleteProperty(PROP_VISION_API_KEY);
  }
  return hasVisionKey_();
}

/**
 * OCR 1 file (ảnh hoặc PDF) bằng Vision. Trả về text.
 * Ném lỗi nếu thất bại (để tầng gọi có thể fallback về Drive OCR).
 */
function ocrWithVision_(fileId, mimeType) {
  var key = getVisionApiKey_();
  if (!key) throw new Error('Chưa cấu hình Vision API key.');

  var file = DriveApp.getFileById(fileId);
  var size = file.getSize();
  if (size > VISION_MAX_BYTES) {
    throw new Error('File quá lớn cho Vision (' + Math.round(size / 1048576) + 'MB).');
  }
  var blob = file.getBlob();
  var b64 = Utilities.base64Encode(blob.getBytes());

  if (mimeType === SUPPORTED_MIME.PDF || mimeType === SUPPORTED_MIME.TIFF) {
    var pages = [];
    for (var i = 1; i <= VISION_PDF_MAX_PAGES; i++) pages.push(i);
    return visionAnnotateFile_(b64, mimeType, key, pages).text;
  }
  return visionAnnotateImage_(b64, key);
}

/**
 * OCR một cụm trang cụ thể của PDF/TIFF qua Vision.
 * Trả về { text, totalPages, pagesDone }.
 */
function ocrVisionPages_(fileId, mimeType, pages) {
  var key = getVisionApiKey_();
  if (!key) throw new Error('Chưa cấu hình Vision API key.');
  var file = DriveApp.getFileById(fileId);
  if (file.getSize() > VISION_MAX_BYTES) {
    throw new Error('File quá lớn cho Vision.');
  }
  var b64 = Utilities.base64Encode(file.getBlob().getBytes());
  var r = visionAnnotateFile_(b64, mimeType, key, pages);
  return { text: r.text, totalPages: r.totalPages, pagesDone: r.pagesDone };
}

/**
 * Ảnh (PNG/JPG/GIF): images:annotate (đồng bộ).
 */
function visionAnnotateImage_(b64, key) {
  var url = 'https://vision.googleapis.com/v1/images:annotate?key=' + encodeURIComponent(key);
  var payload = {
    requests: [{
      image: { content: b64 },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: VISION_LANGUAGE_HINTS }
    }]
  };
  var res = visionFetch_(url, payload);
  var r = res.responses && res.responses[0];
  if (r && r.error) throw new Error('Vision: ' + r.error.message);
  return (r && r.fullTextAnnotation && r.fullTextAnnotation.text) || '';
}

/**
 * PDF/TIFF: files:annotate (đồng bộ). OCR các trang trong mảng `pages` (tối đa 5).
 * Trả về { text, totalPages, pagesDone }.
 */
function visionAnnotateFile_(b64, mimeType, key, pages) {
  if (!pages || !pages.length) {
    pages = [];
    for (var i = 1; i <= VISION_PDF_MAX_PAGES; i++) pages.push(i);
  }
  var url = 'https://vision.googleapis.com/v1/files:annotate?key=' + encodeURIComponent(key);
  var payload = {
    requests: [{
      inputConfig: { content: b64, mimeType: mimeType },
      features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
      imageContext: { languageHints: VISION_LANGUAGE_HINTS },
      pages: pages
    }]
  };
  var res = visionFetch_(url, payload);
  var top = res.responses && res.responses[0];
  if (top && top.error) throw new Error('Vision: ' + top.error.message);
  // files:annotate trả responses[0].responses[] cho từng trang + totalPages tổng số trang.
  var pageResponses = (top && top.responses) || [];
  var texts = [];
  for (var p = 0; p < pageResponses.length; p++) {
    var pr = pageResponses[p];
    if (pr && pr.fullTextAnnotation && pr.fullTextAnnotation.text) {
      texts.push(pr.fullTextAnnotation.text);
    }
  }
  return {
    text: texts.join('\n'),
    totalPages: (top && top.totalPages) || pages.length,
    pagesDone: pageResponses.length || pages.length
  };
}

function visionFetch_(url, payload) {
  var resp = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code < 200 || code >= 300) {
    var msg = body;
    try { msg = JSON.parse(body).error.message; } catch (e) {}
    throw new Error('Vision API lỗi ' + code + ': ' + msg);
  }
  return JSON.parse(body);
}

/**
 * Kiểm tra nhanh API key có hợp lệ không (gọi 1 ảnh trắng nhỏ).
 */
function testVisionKey() {
  var key = getVisionApiKey_();
  if (!key) return { ok: false, message: 'Chưa nhập API key.' };
  // ảnh PNG 1x1 trong suốt (base64)
  var onePx = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  try {
    visionAnnotateImage_(onePx, key);
    return { ok: true, message: 'API key hợp lệ. OCR nâng cao đã sẵn sàng.' };
  } catch (e) {
    return { ok: false, message: String(e && e.message || e) };
  }
}
