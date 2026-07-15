/**
 * Storage.gs
 * Khởi tạo và thao tác với "database" (Google Sheets) + folder gốc trên Drive.
 */

// Cột của sheet VanBan (thứ tự cố định)
var COLS = {
  FILE_ID: 0,
  FILE_NAME: 1,
  DOC_TYPE: 2,       // Tên loại VB (Quyết định, Thông báo...)
  DOC_TYPE_CODE: 3,  // Mã loại (QD, TB...)
  DOC_NUMBER: 4,     // Số/ký hiệu văn bản
  ISSUED_DATE: 5,    // Ngày ban hành (yyyy-MM-dd)
  TITLE: 6,          // Trích yếu / tiêu đề
  CONTENT: 7,        // Nội dung (OCR / trích xuất text)
  FOLDER_PATH: 8,    // Đường dẫn folder tương đối
  MIME_TYPE: 9,
  FILE_URL: 10,      // Link mở file trên Drive
  MODIFIED_TIME: 11, // Thời điểm sửa file gần nhất (ISO)
  SCANNED_AT: 12,    // Thời điểm quét/cập nhật vào DB (ISO)
  OCR_STATUS: 13,    // 'ok' | 'ok-vision' | 'manual' | 'pending' | 'partial' | 'skip' | 'skip-large' | 'error'
  ISSUER: 14,        // Đơn vị ban hành (tên)
  ISSUER_LEVEL: 15,  // Cấp ban hành (Chính phủ, Bộ/Ngành, Trường, Khoa, Phòng/Ban...)
  OCR_PROGRESS: 16,  // Tiến độ OCR dạng 'done/total' (số trang đã OCR / tổng số trang)
  STATUS: 17,        // Trạng thái xử lý
  SECURITY: 18,      // Độ mật
  URGENCY: 19        // Độ khẩn
};

var DB_HEADERS = [
  'FileId', 'Tên file', 'Loại văn bản', 'Mã loại', 'Số/Ký hiệu',
  'Ngày ban hành', 'Trích yếu', 'Nội dung', 'Đường dẫn', 'MimeType',
  'Link Drive', 'Sửa lần cuối', 'Quét lúc', 'OCR',
  'Đơn vị ban hành', 'Cấp ban hành', 'OCR tiến độ',
  'Trạng thái', 'Độ mật', 'Độ khẩn'
];

/**
 * Trả về folder gốc; tự tạo nếu chưa cấu hình.
 */
function getOrCreateRootFolder() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_ROOT_FOLDER_ID);
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // folder bị xoá -> tạo lại
    }
  }
  var folder = DriveApp.createFolder(DEFAULT_ROOT_FOLDER_NAME);
  folder.setDescription('Folder gốc chứa văn bản - Hệ thống QLVB ĐH Điện lực');
  props.setProperty(PROP_ROOT_FOLDER_ID, folder.getId());
  return folder;
}

/**
 * Trả về folder gốc nếu đã cấu hình & còn tồn tại; KHÔNG tạo mới. Trả null nếu chưa có.
 */
function getExistingRootFolder_() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_ROOT_FOLDER_ID);
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

/**
 * Trả về Spreadsheet database; tự tạo nếu chưa có.
 * Ghi nhớ trong 1 lần chạy (execution) để tránh mở lại + kiểm tra sheet nhiều lần -> nhanh hơn.
 */
var _dbCache = null;
function getOrCreateDatabase() {
  if (_dbCache) return _dbCache;
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty(PROP_DB_SPREADSHEET_ID);
  var ss;
  if (id) {
    try {
      ss = SpreadsheetApp.openById(id);
    } catch (e) {
      ss = null;
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create(DEFAULT_DB_SPREADSHEET_NAME);
    props.setProperty(PROP_DB_SPREADSHEET_ID, ss.getId());
    // Đưa spreadsheet vào folder gốc cho gọn
    try {
      var root = getOrCreateRootFolder();
      var file = DriveApp.getFileById(ss.getId());
      root.addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    } catch (e) { /* bỏ qua nếu không di chuyển được */ }
  }
  ensureSheets_(ss);
  migrateIssuedDates_(ss); // chuyển ngày cũ (dạng chữ) sang ngày thật để hiển thị dd/mm/yyyy
  _dbCache = ss;
  return ss;
}

// Chuyển cột "Ngày ban hành" từ chữ 'yyyy-MM-dd' sang Date thật (chạy 1 lần).
function migrateIssuedDates_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('DATE_FMT_MIGRATED_V1')) return;
  try {
    var docs = ss.getSheetByName(DB_SHEET_DOCS);
    var lastRow = docs.getLastRow();
    if (lastRow >= 2) {
      var rng = docs.getRange(2, COLS.ISSUED_DATE + 1, lastRow - 1, 1);
      var vals = rng.getValues();
      var changed = false;
      for (var i = 0; i < vals.length; i++) {
        var v = vals[i][0];
        if (typeof v === 'string') {
          var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
          if (m) {
            vals[i][0] = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
            changed = true;
          }
        }
      }
      if (changed) rng.setValues(vals);
      rng.setNumberFormat('dd/mm/yyyy');
    }
    props.setProperty('DATE_FMT_MIGRATED_V1', '1');
  } catch (e) { /* không để migration làm hỏng luồng chính */ }
}

function ensureSheets_(ss) {
  // Sheet VanBan
  var docs = ss.getSheetByName(DB_SHEET_DOCS);
  if (!docs) {
    docs = ss.getSheets()[0];
    docs.setName(DB_SHEET_DOCS);
  }
  if (docs.getLastRow() === 0) {
    docs.getRange(1, 1, 1, DB_HEADERS.length).setValues([DB_HEADERS]);
    docs.setFrozenRows(1);
    docs.getRange(1, 1, 1, DB_HEADERS.length).setFontWeight('bold')
        .setBackground('#0B5394').setFontColor('#ffffff');
  } else {
    // Bổ sung cột tiêu đề mới (tương thích CSDL cũ) nếu thiếu/khác.
    var curHeaders = docs.getRange(1, 1, 1, DB_HEADERS.length).getValues()[0];
    var needFix = false;
    for (var h = 0; h < DB_HEADERS.length; h++) {
      if (curHeaders[h] !== DB_HEADERS[h]) { needFix = true; break; }
    }
    if (needFix) {
      docs.getRange(1, 1, 1, DB_HEADERS.length).setValues([DB_HEADERS]);
      docs.getRange(1, 1, 1, DB_HEADERS.length).setFontWeight('bold')
          .setBackground('#0B5394').setFontColor('#ffffff');
    }
  }
  // Định dạng cột "Ngày ban hành" dd/mm/yyyy — chỉ chạy MỘT LẦN (tránh ghi lại mỗi lời gọi -> chậm).
  var props0 = PropertiesService.getScriptProperties();
  if (!props0.getProperty('DATE_COL_FMT_V1')) {
    try {
      docs.getRange(2, COLS.ISSUED_DATE + 1, Math.max(1, docs.getMaxRows() - 1), 1)
          .setNumberFormat('dd/mm/yyyy');
    } catch (e) { /* bỏ qua */ }
    props0.setProperty('DATE_COL_FMT_V1', '1');
  }
  // Sheet NhatKy
  var log = ss.getSheetByName(DB_SHEET_LOG);
  if (!log) {
    log = ss.insertSheet(DB_SHEET_LOG);
    log.getRange(1, 1, 1, 4).setValues([['Thời điểm', 'Hành động', 'Số VB', 'Ghi chú']]);
    log.setFrozenRows(1);
    log.getRange(1, 1, 1, 4).setFontWeight('bold');
  }
}

function getDocsSheet_() {
  return getOrCreateDatabase().getSheetByName(DB_SHEET_DOCS);
}

/**
 * Đọc toàn bộ văn bản trong DB dưới dạng mảng object.
 */
function readAllDocs() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var values = sheet.getRange(2, 1, lastRow - 1, DB_HEADERS.length).getValues();
  return values.map(rowToObj_);
}

/**
 * Lấy chi tiết 1 văn bản NHANH: chỉ đọc cột FileId để tìm dòng, rồi đọc đúng 1 dòng đó
 * (không đọc toàn bộ cột nội dung của tất cả văn bản như readAllDocs).
 */
function getDocDetailFast_(fileId) {
  if (!fileId) return null;
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return null;
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(fileId)) {
      var r = sheet.getRange(i + 2, 1, 1, DB_HEADERS.length).getValues()[0];
      return rowToObj_(r);
    }
  }
  return null;
}

// Ép ô về chuỗi "sạch" để google.script.run tuần tự hoá được (tránh trả null).
function cell_(v) {
  if (v == null) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', "yyyy-MM-dd'T'HH:mm:ss");
  return String(v);
}
// Ép ô ngày về dạng 'yyyy-MM-dd' (Sheets có thể tự đổi chuỗi ngày thành Date).
function dateCell_(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var s = String(v);
  return s.substring(0, 10); // giữ đúng 'yyyy-MM-dd' nếu lỡ có kèm giờ
}

function rowToObj_(r) {
  return {
    fileId: cell_(r[COLS.FILE_ID]),
    fileName: cell_(r[COLS.FILE_NAME]),
    docType: cell_(r[COLS.DOC_TYPE]),
    docTypeCode: cell_(r[COLS.DOC_TYPE_CODE]),
    docNumber: cell_(r[COLS.DOC_NUMBER]),
    issuedDate: dateCell_(r[COLS.ISSUED_DATE]),
    title: cell_(r[COLS.TITLE]),
    content: cell_(r[COLS.CONTENT]),
    folderPath: cell_(r[COLS.FOLDER_PATH]),
    mimeType: cell_(r[COLS.MIME_TYPE]),
    fileUrl: cell_(r[COLS.FILE_URL]),
    modifiedTime: cell_(r[COLS.MODIFIED_TIME]),
    scannedAt: cell_(r[COLS.SCANNED_AT]),
    ocrStatus: cell_(r[COLS.OCR_STATUS]),
    issuer: cell_(r[COLS.ISSUER]),
    issuerLevel: cell_(r[COLS.ISSUER_LEVEL]),
    ocrProgress: cell_(r[COLS.OCR_PROGRESS]),
    status: cell_(r[COLS.STATUS]),
    security: cell_(r[COLS.SECURITY]),
    urgency: cell_(r[COLS.URGENCY])
  };
}

/**
 * Map fileId -> {rowIndex (1-based tuyệt đối trong sheet), modifiedTime}
 */
function getExistingIndex_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow < 2) return map;
  // Chỉ đọc cột FileId và nhóm cột MODIFIED_TIME..OCR_STATUS -> KHÔNG đọc cột nội dung nặng.
  var n = lastRow - 1;
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, n, 1).getValues();
  var meta = sheet.getRange(2, COLS.MODIFIED_TIME + 1, n, COLS.OCR_STATUS - COLS.MODIFIED_TIME + 1).getValues();
  var mOff = 0, oOff = COLS.OCR_STATUS - COLS.MODIFIED_TIME;
  for (var i = 0; i < ids.length; i++) {
    map[ids[i][0]] = {
      rowIndex: i + 2,
      modifiedTime: meta[i][mOff],
      ocrStatus: meta[i][oOff]
    };
  }
  return map;
}

// Chuyển 'yyyy-MM-dd' thành đối tượng Date (giờ địa phương) để ô Sheet hiển thị dd/mm/yyyy.
// Trả '' nếu rỗng, hoặc giữ nguyên nếu không đúng định dạng.
function issuedToCell_(s) {
  if (!s) return '';
  if (s instanceof Date) return s;
  var m = String(s).match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
  return s;
}

function docToRow_(d) {
  var row = new Array(DB_HEADERS.length).fill('');
  row[COLS.FILE_ID] = d.fileId;
  row[COLS.FILE_NAME] = d.fileName;
  row[COLS.DOC_TYPE] = d.docType;
  row[COLS.DOC_TYPE_CODE] = d.docTypeCode;
  row[COLS.DOC_NUMBER] = d.docNumber;
  row[COLS.ISSUED_DATE] = issuedToCell_(d.issuedDate); // ghi dạng ngày thật để Sheet hiển thị dd/mm/yyyy
  row[COLS.TITLE] = d.title;
  row[COLS.CONTENT] = d.content;
  row[COLS.FOLDER_PATH] = d.folderPath;
  row[COLS.MIME_TYPE] = d.mimeType;
  row[COLS.FILE_URL] = d.fileUrl;
  row[COLS.MODIFIED_TIME] = d.modifiedTime;
  row[COLS.SCANNED_AT] = d.scannedAt;
  row[COLS.OCR_STATUS] = d.ocrStatus;
  row[COLS.ISSUER] = d.issuer || '';
  row[COLS.ISSUER_LEVEL] = d.issuerLevel || '';
  row[COLS.OCR_PROGRESS] = d.ocrProgress || '';
  row[COLS.STATUS] = d.status || '';
  row[COLS.SECURITY] = d.security || '';
  row[COLS.URGENCY] = d.urgency || '';
  return row;
}

function upsertDoc_(d, existing) {
  var sheet = getDocsSheet_();
  var row = docToRow_(d);
  var hit = existing[d.fileId];
  if (hit) {
    sheet.getRange(hit.rowIndex, 1, 1, DB_HEADERS.length).setValues([row]);
    return 'updated';
  } else {
    sheet.appendRow(row);
    // cập nhật lại index để lần sau không thêm trùng
    existing[d.fileId] = { rowIndex: sheet.getLastRow(), modifiedTime: d.modifiedTime };
    return 'inserted';
  }
}

/**
 * Xoá khỏi DB các file không còn tồn tại trên Drive.
 * livingIds: object các fileId còn tồn tại.
 */
function removeDeletedDocs_(livingIds) {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  var toDelete = [];
  for (var i = 0; i < ids.length; i++) {
    if (!livingIds[ids[i][0]]) toDelete.push(i + 2);
  }
  // xoá từ dưới lên để không lệch chỉ số
  for (var j = toDelete.length - 1; j >= 0; j--) {
    sheet.deleteRow(toDelete[j]);
  }
  return toDelete.length;
}

/**
 * Cập nhật thông tin văn bản bằng tay (khi OCR sai/thiếu).
 * p: { fileId, docTypeCode, docNumber, issuedDate, title, content }
 * Chỉ cập nhật các trường được truyền vào (khác undefined).
 * Đặt ocrStatus='manual' để lần quét sau KHÔNG ghi đè bản sửa tay.
 */
function updateDocManual(p) {
  if (!p || !p.fileId) throw new Error('Thiếu mã văn bản (fileId).');
  var cur = getDocDetailFast_(p.fileId);
  if (!cur) throw new Error('Không tìm thấy văn bản trong cơ sở dữ liệu.');
  var existing = getExistingIndex_();

  if (p.docTypeCode != null && p.docTypeCode !== '') {
    cur.docTypeCode = p.docTypeCode;
    cur.docType = getTypeName_(p.docTypeCode);
  }
  if (p.docNumber != null) cur.docNumber = String(p.docNumber);
  if (p.issuedDate != null) cur.issuedDate = normalizeDateInput_(p.issuedDate);
  if (p.title != null) cur.title = String(p.title);
  if (p.content != null) cur.content = String(p.content).substring(0, 45000);
  if (p.issuer != null) cur.issuer = String(p.issuer).trim();
  if (p.issuerLevel != null) cur.issuerLevel = String(p.issuerLevel).trim();
  if (p.status != null) cur.status = String(p.status).trim();
  if (p.security != null) cur.security = String(p.security).trim();
  if (p.urgency != null) cur.urgency = String(p.urgency).trim();

  cur.ocrStatus = 'manual';
  cur.scannedAt = new Date().toISOString();
  upsertDoc_(cur, existing);
  writeLog_('Sửa tay', 1, cur.fileName);
  return cur;
}

/**
 * Xoá 1 văn bản khỏi hệ thống: gỡ dòng trong CSDL, và (mặc định) chuyển file
 * trên Drive vào thùng rác để lần quét sau không thêm lại. File vẫn khôi phục được từ Thùng rác Drive.
 */
function deleteDocById_(fileId, trashFile) {
  if (!fileId) throw new Error('Thiếu mã văn bản.');
  var sheet = getDocsSheet_();
  var existing = getExistingIndex_();
  var hit = existing[fileId];
  var name = fileId;
  try { name = DriveApp.getFileById(fileId).getName(); } catch (e) {}

  var removed = false;
  if (hit) { sheet.deleteRow(hit.rowIndex); removed = true; }

  var trashed = false;
  if (trashFile !== false) {
    try { DriveApp.getFileById(fileId).setTrashed(true); trashed = true; } catch (e) {}
  }
  writeLog_('Xoá văn bản', 1, name + (trashed ? ' (đã đưa vào thùng rác Drive)' : ' (chỉ gỡ khỏi danh sách)'));
  return { ok: true, removed: removed, trashed: trashed };
}

// Chuẩn hoá ngày nhập tay về 'yyyy-MM-dd' (chấp nhận rỗng).
function normalizeDateInput_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  var s = String(v).trim();
  var m = s.match(/^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) return m[1] + '-' + pad2_(m[2]) + '-' + pad2_(m[3]);
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); // dd/mm/yyyy
  if (m) return m[3] + '-' + pad2_(m[2]) + '-' + pad2_(m[1]);
  return s.substring(0, 10);
}
function pad2_(n) { n = parseInt(n, 10); return n < 10 ? '0' + n : '' + n; }

function writeLog_(action, count, note) {
  try {
    var ss = getOrCreateDatabase();
    var log = ss.getSheetByName(DB_SHEET_LOG);
    log.appendRow([new Date(), action, count, note || '']);
  } catch (e) { /* không để log làm hỏng luồng chính */ }
}
