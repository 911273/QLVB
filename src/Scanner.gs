/**
 * Scanner.gs
 * Tự động quét folder gốc trên Drive, phát hiện file mới/đã sửa,
 * OCR + phân loại + ghi vào database.
 */

// Giới hạn số file xử lý mỗi lần quét để tránh timeout (Apps Script ~6 phút).
var SCAN_BATCH_LIMIT = 40;

/**
 * Quét toàn bộ folder gốc (đệ quy) và cập nhật DB.
 * options: { force: Boolean } - force=true sẽ OCR lại cả file cũ.
 * Trả về thống kê.
 */
function scanDrive(options) {
  options = options || {};
  var force = !!options.force;

  var root = getOrCreateRootFolder();
  getOrCreateDatabase(); // đảm bảo DB tồn tại
  var existing = getExistingIndex_();

  var stats = { scanned: 0, inserted: 0, updated: 0, skipped: 0, ocr: 0, queued: 0, errors: 0, deleted: 0, limitHit: false };
  var livingIds = {};

  var files = collectFiles_(root, '', []);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    livingIds[f.id] = true;

    var hit = existing[f.id];

    // Giữ nguyên metadata của văn bản đã sửa tay (không để quét ghi đè). Nội dung vẫn
    // được OCR riêng qua hàng đợi OCR.
    if (hit && hit.edited) {
      stats.skipped++;
      continue;
    }

    var changed = !hit || Number(hit.modifiedTime) !== Number(f.modifiedTime);

    // Nếu file không đổi và đã có kết quả OCR (hoặc đang OCR dở), giữ nguyên để không
    // mất nội dung và không tốn hạn mức - kể cả khi bấm "Quét lại toàn bộ".
    var preserved = hit && !changed &&
      ['ok', 'ok-vision', 'partial', 'skip', 'skip-large'].indexOf(hit.ocrStatus) !== -1;
    if (preserved) {
      stats.skipped++;
      continue;
    }

    if (!force && !changed) {
      stats.skipped++;
      continue;
    }
    if (stats.scanned >= SCAN_BATCH_LIMIT) {
      stats.limitHit = true;
      break;
    }

    try {
      var doc = processFile_(f, existing);
      stats.scanned++;
      if (doc.ocrStatus === 'ok') stats.ocr++;
      if (doc.ocrStatus === 'pending') stats.queued++;
      if (doc._op === 'inserted') stats.inserted++;
      else stats.updated++;
    } catch (e) {
      stats.errors++;
      Logger.log('processFile error: ' + f.name + ' -> ' + e);
    }
  }

  // Chỉ dọn file đã xoá khi đã duyệt hết (không bị cắt do limit)
  if (!stats.limitHit) {
    stats.deleted = removeDeletedDocs_(livingIds);
  }

  PropertiesService.getScriptProperties().setProperty(PROP_LAST_SCAN, new Date().toISOString());
  stats.duplicates = refreshDuplicateCount_(); // tự động rà soát trùng lặp (nhanh) sau khi quét
  writeLog_('Quét Drive', stats.scanned,
    'Thêm ' + stats.inserted + ', Cập nhật ' + stats.updated +
    ', OCR ' + stats.ocr + ', Xoá ' + stats.deleted +
    (stats.limitHit ? ' (còn file chưa xử lý - chạy lại để tiếp tục)' : ''));

  return stats;
}

/**
 * Thu thập đệ quy tất cả file được hỗ trợ trong folder.
 */
function collectFiles_(folder, path, acc) {
  var supported = {};
  Object.keys(SUPPORTED_MIME).forEach(function (k) { supported[SUPPORTED_MIME[k]] = true; });

  var it = folder.getFiles();
  while (it.hasNext()) {
    var file = it.next();
    var mime = file.getMimeType();
    if (!supported[mime]) continue;
    acc.push({
      id: file.getId(),
      name: file.getName(),
      mimeType: mime,
      url: file.getUrl(),
      modifiedTime: file.getLastUpdated().getTime(), // epoch millis (số) để so sánh ổn định
      createdDate: file.getDateCreated(),
      folderPath: path || '/'
    });
  }
  var sub = folder.getFolders();
  while (sub.hasNext()) {
    var sf = sub.next();
    collectFiles_(sf, path + '/' + sf.getName(), acc);
  }
  return acc;
}

/**
 * Xử lý 1 file: OCR/đọc nội dung -> phân loại -> trích metadata -> upsert.
 */
function processFile_(f, existing) {
  var isOcrType = OCR_MIME_TYPES.indexOf(f.mimeType) !== -1;
  var content = '';
  var ocrStatus, ocrProgress = '';

  if (isOcrType) {
    // Ảnh/PDF: KHÔNG OCR ngay khi quét (tránh chậm & vượt hạn mức) -> xếp hàng đợi OCR.
    ocrStatus = 'pending';
  } else {
    // Google Docs/Word: đọc text ngay (miễn phí, nhanh).
    var res = extractContent(f.id, f.mimeType);
    content = (res.text || '').substring(0, 45000);
    ocrStatus = res.status;
  }

  var cls = classifyDoc(f.name, content);
  var docNumber = extractDocNumber(f.name, content);
  var issued = extractIssuedDate(f.name, content, f.createdDate);
  var title = extractTitle(f.name, content);
  var issuer = detectIssuer_(f.name, content);

  var doc = {
    fileId: f.id,
    fileName: f.name,
    docType: cls.name,
    docTypeCode: cls.code,
    docNumber: docNumber,
    issuedDate: issued,
    title: title,
    content: content,
    folderPath: f.folderPath,
    mimeType: f.mimeType,
    fileUrl: f.url,
    modifiedTime: f.modifiedTime,
    scannedAt: new Date().toISOString(),
    ocrStatus: ocrStatus,
    issuer: issuer.name,
    issuerLevel: issuer.level,
    ocrProgress: ocrProgress,
    status: 'Mới',
    security: 'Thường',
    urgency: 'Thường',
    keywords: '',
    analysis: ''
  };
  analyzeAndAttach_(doc); // tính key phrases + hồ sơ phân tích (nội dung có thể rỗng nếu chờ OCR)
  var op = upsertDoc_(doc, existing);
  doc._op = op;
  return doc;
}

/**
 * Cài đặt trigger tự động quét theo giờ (mặc định mỗi 6 tiếng).
 */
function installAutoScanTrigger(hours) {
  hours = hours || 6;
  removeAutoScanTrigger();
  ScriptApp.newTrigger('autoScanJob')
    .timeBased()
    .everyHours(hours)
    .create();
  return 'Đã bật tự động quét mỗi ' + hours + ' giờ.';
}

function removeAutoScanTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoScanJob') {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  return removed;
}

function hasAutoScanTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'autoScanJob') return true;
  }
  return false;
}

/**
 * Hàm được trigger gọi. Lặp cho tới khi hết file (mỗi lần 1 batch).
 */
function autoScanJob() {
  scanDrive({ force: false });
}
