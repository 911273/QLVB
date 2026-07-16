/**
 * OcrQueue.gs
 * Hàng đợi OCR: quét chỉ lập chỉ mục nhanh và xếp OCR vào hàng đợi;
 * tiến trình nền OCR "từ từ" theo lịch, mỗi lượt vài văn bản, mỗi PDF vài trang,
 * và có hạn mức số trang/ngày để không vượt giới hạn miễn phí của Google (Vision).
 *
 * Trạng thái OCR liên quan:
 *   'pending'  - đã xếp hàng, chưa OCR trang nào
 *   'partial'  - đã OCR một phần (PDF nhiều trang), còn trang chưa OCR
 *   'ok'/'ok-vision' - đã OCR xong
 *   'skip-large' - file quá lớn, không OCR inline được (nên tách nhỏ)
 *   'error'    - lỗi khi OCR
 */

// Văn bản cần xử lý trong hàng đợi (chưa OCR xong).
function needsOcr_(d) {
  if (!d) return false;
  if (OCR_MIME_TYPES.indexOf(d.mimeType) === -1) return false;
  return d.ocrStatus === 'pending' || d.ocrStatus === 'partial';
}

// Đếm số văn bản đang chờ OCR (chỉ đọc cột MimeType & OCR, không đọc nội dung -> nhanh).
function ocrQueueCount() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var n = lastRow - 1;
  var mimes = sheet.getRange(2, COLS.MIME_TYPE + 1, n, 1).getValues();
  var stat = sheet.getRange(2, COLS.OCR_STATUS + 1, n, 1).getValues();
  var c = 0;
  for (var i = 0; i < n; i++) {
    var st = stat[i][0];
    if ((st === 'pending' || st === 'partial') && OCR_MIME_TYPES.indexOf(mimes[i][0]) !== -1) c++;
  }
  return c;
}

function parseProgress_(s) {
  var m = String(s || '').match(/^(\d+)\s*\/\s*(\d+)/);
  if (m) return { done: parseInt(m[1], 10), total: parseInt(m[2], 10) };
  return { done: 0, total: 0 };
}

function appendContent_(oldText, addText) {
  var t = (oldText ? oldText + '\n' : '') + (addText || '');
  return t.substring(0, 45000);
}

/**
 * OCR "một bước" cho 1 văn bản (vài trang). Trả về:
 *   { status, pages (số trang Vision đã dùng), content, progress, done }
 * Nếu hết ngân sách -> { skip:true }.
 */
function ocrOneStep_(d, budgetPages) {
  var file = DriveApp.getFileById(d.fileId);
  var mime = d.mimeType || file.getMimeType();
  var size = file.getSize();
  var useVision = hasVisionKey_();

  if (useVision) {
    if (size > VISION_MAX_BYTES) {
      return { status: 'skip-large', pages: 0, content: d.content, progress: d.ocrProgress || '', done: true };
    }
    if (mime === SUPPORTED_MIME.PDF || mime === SUPPORTED_MIME.TIFF) {
      var prog = parseProgress_(d.ocrProgress);
      var start = prog.done; // số trang đã OCR
      // Đã OCR hết -> hoàn tất.
      if (prog.total > 0 && start >= prog.total) {
        return { status: 'ok-vision', pages: 0, content: d.content, progress: start + '/' + prog.total, done: true };
      }
      var count = Math.min(OCR_VISION_PAGES_PER_RUN, budgetPages);
      if (prog.total > 0) count = Math.min(count, prog.total - start);
      if (count <= 0) return { skip: true };
      var pages = [];
      for (var i = 0; i < count; i++) pages.push(start + 1 + i);
      var r = ocrVisionPages_(d.fileId, mime, pages);
      var total = r.totalPages || prog.total || (start + count);
      var newDone = Math.min(total, start + count); // tiến chắc chắn theo số trang đã yêu cầu
      var isDone = newDone >= total;
      return {
        status: isDone ? 'ok-vision' : 'partial',
        pages: count,
        content: appendContent_(d.content, r.text),
        progress: newDone + '/' + total,
        done: isDone
      };
    }
    // Ảnh: OCR trọn (tính 1 trang).
    var timg = ocrWithVision_(d.fileId, mime);
    return { status: 'ok-vision', pages: 1, content: timg, progress: '1/1', done: true };
  }

  // Không có Vision -> Drive OCR (miễn phí, không tính ngân sách), OCR trọn 1 lần.
  if (size > MAX_OCR_BYTES) {
    return { status: 'skip-large', pages: 0, content: d.content, progress: d.ocrProgress || '', done: true };
  }
  var res = extractContent(d.fileId, mime);
  return { status: (res.status === 'ok' ? 'ok' : res.status), pages: 0, content: res.text, progress: '', done: true };
}

/**
 * Sau khi OCR xong: suy lại loại/số hiệu/ngày/đơn vị/trích yếu từ nội dung (nếu còn thiếu).
 */
function finalizeDocAfterOcr_(d) {
  var content = d.content || '';
  // Luôn cập nhật từ khóa theo nội dung mới (kể cả bản đã sửa tay).
  d.keywords = computeKeywords_((d.title || '') + ' ' + content);
  // Bản đã sửa tay: chỉ giữ nội dung vừa OCR, KHÔNG suy lại metadata (giữ chỉnh sửa của người dùng).
  if (d.edited) return;
  d.title = extractTitle(d.fileName, content) || d.title;
  if (!d.docNumber) d.docNumber = extractDocNumber(d.fileName, content);
  if (!d.docTypeCode || d.docTypeCode === 'KHAC') {
    var cls = classifyDoc(d.fileName, content);
    d.docType = cls.name; d.docTypeCode = cls.code;
  }
  if (!d.issuer) {
    var iss = detectIssuer_(d.fileName, content);
    d.issuer = iss.name; d.issuerLevel = iss.level;
  }
  if (!d.issuedDate) d.issuedDate = extractIssuedDate(d.fileName, content, null);
}

/**
 * Chạy hàng đợi OCR một lượt.
 * options: { maxFiles }
 */
function ocrQueueRun(options) {
  options = options || {};
  var maxFiles = options.maxFiles || OCR_QUEUE_BATCH_FILES;
  var docs = readAllDocs();
  var existing = getExistingIndex_();
  var useVision = hasVisionKey_();
  var budget = ocrBudgetRemaining_();

  var stats = {
    processed: 0, completed: 0, partial: 0, skippedLarge: 0, errors: 0,
    pagesUsed: 0, remainingQueue: 0, budgetLeft: budget, usedVision: useVision
  };

  for (var i = 0; i < docs.length; i++) {
    var d = docs[i];
    if (!needsOcr_(d)) continue;

    if (stats.processed >= maxFiles) { stats.remainingQueue++; continue; }
    if (useVision && budget <= 0) { stats.remainingQueue++; continue; }

    try {
      var step = ocrOneStep_(d, budget);
      if (step.skip) { stats.remainingQueue++; continue; }

      d.content = step.content;
      d.ocrStatus = step.status;
      d.ocrProgress = step.progress || '';
      if (step.done && (step.status === 'ok' || step.status === 'ok-vision')) {
        finalizeDocAfterOcr_(d);
      }
      upsertDoc_(d, existing);

      stats.processed++;
      if (useVision) { budget -= step.pages; stats.pagesUsed += step.pages; }
      if (step.status === 'ok' || step.status === 'ok-vision') stats.completed++;
      else if (step.status === 'partial') { stats.partial++; stats.remainingQueue++; }
      else if (step.status === 'skip-large') stats.skippedLarge++;
    } catch (e) {
      stats.errors++;
      d.ocrStatus = 'error';
      try { upsertDoc_(d, existing); } catch (e2) {}
      Logger.log('ocrQueue error ' + d.fileName + ': ' + e);
    }
  }

  if (stats.pagesUsed > 0) ocrConsume_(stats.pagesUsed);
  stats.budgetLeft = ocrBudgetRemaining_();
  writeLog_('OCR hàng đợi', stats.processed,
    'Xong ' + stats.completed + ', còn dở ' + stats.partial +
    ', trang Vision ' + stats.pagesUsed + ', còn chờ ' + stats.remainingQueue);
  return stats;
}

/* ===================== Lịch tự động OCR ===================== */
function installOcrTrigger(hours) {
  hours = hours || 1;
  removeOcrTrigger();
  ScriptApp.newTrigger('ocrQueueJob').timeBased().everyHours(hours).create();
  return 'Đã bật OCR tự động mỗi ' + hours + ' giờ.';
}
function removeOcrTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  var n = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ocrQueueJob') {
      ScriptApp.deleteTrigger(triggers[i]); n++;
    }
  }
  return n;
}
function hasOcrTrigger() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'ocrQueueJob') return true;
  }
  return false;
}
function ocrQueueJob() {
  ocrQueueRun({});
}
