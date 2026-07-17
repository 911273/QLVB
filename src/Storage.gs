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
  URGENCY: 19,       // Độ khẩn
  EDITED: 20,        // Đã sửa thông tin bằng tay (bảo vệ metadata, nhưng vẫn OCR nội dung)
  KEYWORDS: 21,      // 3–5 key phrase (cụm|trọng số) - hiển thị & hỗ trợ độ liên quan
  ANALYSIS: 22,      // Hồ sơ phân tích nội dung (JSON: topic/field/concepts/entities/legalRefs + cờ sửa tay)
  FIELD: 23,         // Lĩnh vực (tự nhận diện hoặc sửa tay)
  VALIDITY: 24,      // Hiệu lực: Còn hiệu lực / Hết hiệu lực / Chưa xác định
  RELATIONS: 25      // Quan hệ văn bản (JSON: replaces/replacedBy/related - danh sách fileId)
};

var DB_HEADERS = [
  'FileId', 'Tên file', 'Loại văn bản', 'Mã loại', 'Số/Ký hiệu',
  'Ngày ban hành', 'Trích yếu', 'Nội dung', 'Đường dẫn', 'MimeType',
  'Link Drive', 'Sửa lần cuối', 'Quét lúc', 'OCR',
  'Đơn vị ban hành', 'Cấp ban hành', 'OCR tiến độ',
  'Trạng thái', 'Độ mật', 'Độ khẩn', 'Đã sửa', 'Từ khóa', 'Phân tích',
  'Lĩnh vực', 'Hiệu lực', 'Liên kết'
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
  migrateManualStatus_(ss); // dữ liệu cũ trạng thái 'manual' -> cờ đã sửa
  migrateKeywords_(ss);     // tính từ khóa cho văn bản cũ đã có nội dung (1 lần)
  migrateAnalysis_(ss);     // tính hồ sơ phân tích + key phrases mới cho văn bản cũ (1 lần)
  migrateFieldValidity_(ss); // backfill cột Lĩnh vực (từ hồ sơ phân tích) + Hiệu lực mặc định (1 lần)
  _dbCache = ss;
  return ss;
}

/* ===================== CẤU HÌNH THƯ MỤC LƯU TRỮ (chỉ Admin) ===================== */
/*
 * Theo ADR-012: chỉ tầng Storage được đọc/ghi cấu hình vị trí lưu trữ.
 * Scanner/Search/OCR không biết Folder ID, chỉ dùng getOrCreateRootFolder()/sheet của Storage.
 */

/**
 * Kiểm tra một Folder ID: có tồn tại & ứng dụng có quyền truy cập không.
 * Trả { ok:true, id, name, url } hoặc { ok:false, error }.
 */
function validateFolder_(id) {
  if (!id) return { ok: false, error: 'Thiếu Folder ID.' };
  try {
    var folder = DriveApp.getFolderById(id);
    var name = folder.getName(); // chạm dữ liệu để chắc chắn có quyền đọc
    return { ok: true, id: folder.getId(), name: name, url: folder.getUrl() };
  } catch (e) {
    return { ok: false, error: 'Không tìm thấy thư mục hoặc ứng dụng không có quyền truy cập.' };
  }
}

/**
 * Cấu hình lưu trữ hiện tại (cho màn hình quản trị): thư mục gốc + spreadsheet DB.
 */
function getStorageConfig_() {
  var props = PropertiesService.getScriptProperties();
  var out = { configured: false, folder: null, database: null };
  var id = props.getProperty(PROP_ROOT_FOLDER_ID);
  if (id) {
    try {
      var f = DriveApp.getFolderById(id);
      out.configured = true;
      out.folder = { id: f.getId(), name: f.getName(), url: f.getUrl() };
    } catch (e) { out.folder = null; }
  }
  var dbId = props.getProperty(PROP_DB_SPREADSHEET_ID);
  if (dbId) {
    try {
      var db = DriveApp.getFileById(dbId);
      out.database = { id: dbId, name: db.getName(), url: db.getUrl() };
    } catch (e) { out.database = null; }
  }
  return out;
}

/**
 * Đổi thư mục lưu trữ (Database Folder) sang folder do Admin cung cấp (URL hoặc ID).
 *  - Trích ID -> kiểm tra tồn tại + quyền truy cập.
 *  - Trỏ PROP_ROOT_FOLDER_ID sang folder mới.
 *  - Rebind DB: dùng lại spreadsheet DB theo tên chuẩn nếu đã có trong folder mới,
 *    ngược lại tạo DB mới trong folder đó. KHÔNG di chuyển dữ liệu cũ (folder cũ giữ nguyên).
 *  - Xoá cache + cờ migration để áp dụng ngay, không cần khởi động lại.
 * Trả { ok:true, folder, database } hoặc { ok:false, error }.
 */
function setStorageFolder_(input) {
  var id = parseFolderId_(input);
  if (!id) return { ok: false, error: 'URL hoặc Folder ID không hợp lệ.' };
  var v = validateFolder_(id);
  if (!v.ok) return { ok: false, error: v.error };

  var props = PropertiesService.getScriptProperties();
  var folder = DriveApp.getFolderById(v.id);

  // Rebind DB spreadsheet: tìm trong folder mới theo tên chuẩn; nếu chưa có thì tạo mới.
  var dbId = '';
  var it = folder.getFilesByName(DEFAULT_DB_SPREADSHEET_NAME);
  while (it.hasNext()) {
    var file = it.next();
    if (file.getMimeType() === MimeType.GOOGLE_SHEETS) { dbId = file.getId(); break; }
  }
  if (!dbId) {
    var ssNew = SpreadsheetApp.create(DEFAULT_DB_SPREADSHEET_NAME);
    dbId = ssNew.getId();
    try {
      var f2 = DriveApp.getFileById(dbId);
      folder.addFile(f2);
      DriveApp.getRootFolder().removeFile(f2);
    } catch (e) { /* bỏ qua nếu không di chuyển được */ }
  }

  // Cập nhật cấu hình.
  props.setProperty(PROP_ROOT_FOLDER_ID, v.id);
  props.setProperty(PROP_DB_SPREADSHEET_ID, dbId);
  // Cho phép các migration chạy lại trên DB mới (nếu là DB có sẵn của folder khác).
  props.deleteProperty('DATE_FMT_MIGRATED_V1');
  props.deleteProperty('MANUAL_FLAG_MIGRATED_V1');
  props.deleteProperty('KEYWORDS_MIGRATED_V2');
  // Số liệu quét/trùng lặp cũ không còn đúng với folder mới.
  props.deleteProperty(PROP_LAST_SCAN);
  props.deleteProperty(PROP_DUP_COUNT);

  // Rebind trong execution hiện tại -> áp dụng ngay.
  _dbCache = null;
  var ss = getOrCreateDatabase(); // mở DB mới + ensureSheets_ + migrate

  return {
    ok: true,
    folder: { id: folder.getId(), name: folder.getName(), url: folder.getUrl() },
    database: { id: dbId, name: ss.getName(), url: DriveApp.getFileById(dbId).getUrl() }
  };
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

// Dữ liệu cũ: ô OCR = 'manual' -> đặt cờ Đã sửa = TRUE, OCR = 'ok' (chạy 1 lần).
function migrateManualStatus_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('MANUAL_FLAG_MIGRATED_V1')) return;
  try {
    var docs = ss.getSheetByName(DB_SHEET_DOCS);
    var lastRow = docs.getLastRow();
    if (lastRow >= 2 && docs.getLastColumn() >= COLS.EDITED + 1) {
      var n = lastRow - 1;
      var ocrCol = docs.getRange(2, COLS.OCR_STATUS + 1, n, 1).getValues();
      var editedCol = docs.getRange(2, COLS.EDITED + 1, n, 1).getValues();
      var changed = false;
      for (var i = 0; i < n; i++) {
        if (String(ocrCol[i][0]) === 'manual') {
          ocrCol[i][0] = 'ok';
          editedCol[i][0] = 'TRUE';
          changed = true;
        }
      }
      if (changed) {
        docs.getRange(2, COLS.OCR_STATUS + 1, n, 1).setValues(ocrCol);
        docs.getRange(2, COLS.EDITED + 1, n, 1).setValues(editedCol);
      }
    }
    props.setProperty('MANUAL_FLAG_MIGRATED_V1', '1');
  } catch (e) { /* không để migration làm hỏng luồng chính */ }
}

// Tính LẠI hồ sơ từ khóa (term|tần suất) cho mọi văn bản đã có nội dung (chạy 1 lần).
function migrateKeywords_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('KEYWORDS_MIGRATED_V2')) return;
  try {
    var docs = ss.getSheetByName(DB_SHEET_DOCS);
    var lastRow = docs.getLastRow();
    if (lastRow >= 2 && docs.getLastColumn() >= COLS.KEYWORDS + 1) {
      var n = lastRow - 1;
      var titles = docs.getRange(2, COLS.TITLE + 1, n, 1).getValues();
      var contents = docs.getRange(2, COLS.CONTENT + 1, n, 1).getValues();
      var kws = docs.getRange(2, COLS.KEYWORDS + 1, n, 1).getValues();
      var changed = false;
      for (var i = 0; i < n; i++) {
        var t = String(titles[i][0] || ''), c = String(contents[i][0] || '');
        if ((t + c).trim()) { kws[i][0] = computeKeywords_(t + ' ' + c); changed = true; }
      }
      if (changed) docs.getRange(2, COLS.KEYWORDS + 1, n, 1).setValues(kws);
    }
    props.setProperty('KEYWORDS_MIGRATED_V2', '1');
  } catch (e) { /* không để migration làm hỏng luồng chính */ }
}

/**
 * Backfill hồ sơ phân tích (cột "Phân tích") + key phrases 3–5 cho văn bản cũ đã có nội dung.
 * Chạy MỘT LẦN, theo lô, đọc các cột cần thiết một lượt rồi ghi một lượt (tiết kiệm quota).
 */
var ANALYSIS_MIGRATE_BATCH = 60; // Số dòng backfill mỗi lượt -> tránh timeout với kho lớn.
function migrateAnalysis_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ANALYSIS_MIGRATED_V1')) return;
  try {
    var docs = ss.getSheetByName(DB_SHEET_DOCS);
    var lastRow = docs.getLastRow();
    if (lastRow < 2 || docs.getLastColumn() < COLS.ANALYSIS + 1) {
      props.setProperty('ANALYSIS_MIGRATED_V1', '1');
      return;
    }
    var n = lastRow - 1;
    // Xử lý theo lô, ghi nhớ con trỏ giữa các lần chạy để không vượt giới hạn 6 phút.
    var start = parseInt(props.getProperty('ANALYSIS_MIGRATE_CURSOR'), 10) || 0;
    var count = Math.min(ANALYSIS_MIGRATE_BATCH, n - start);
    if (count <= 0) {
      props.setProperty('ANALYSIS_MIGRATED_V1', '1');
      props.deleteProperty('ANALYSIS_MIGRATE_CURSOR');
      return;
    }
    var block = docs.getRange(2 + start, 1, count, COLS.ANALYSIS + 1).getValues();
    var kws = [], anas = [], changed = false;
    for (var i = 0; i < count; i++) {
      var d = rowToObj_(block[i]);
      if ((String(d.title || '') + String(d.content || '')).trim()) {
        analyzeAndAttach_(d);
        kws.push([d.keywords]); anas.push([d.analysis]); changed = true;
      } else {
        kws.push([block[i][COLS.KEYWORDS]]); anas.push([block[i][COLS.ANALYSIS]]);
      }
    }
    if (changed) {
      docs.getRange(2 + start, COLS.KEYWORDS + 1, count, 1).setValues(kws);
      docs.getRange(2 + start, COLS.ANALYSIS + 1, count, 1).setValues(anas);
    }
    var next = start + count;
    if (next >= n) {
      props.setProperty('ANALYSIS_MIGRATED_V1', '1');
      props.deleteProperty('ANALYSIS_MIGRATE_CURSOR');
    } else {
      props.setProperty('ANALYSIS_MIGRATE_CURSOR', String(next));
    }
  } catch (e) { Logger.log('migrateAnalysis_ error: ' + e); }
}

/**
 * Backfill cột "Lĩnh vực" (lấy từ hồ sơ phân tích đã có - KHÔNG tính lại) và đặt "Hiệu lực"
 * mặc định cho văn bản cũ. Chạy MỘT LẦN, theo lô. Cần cột RELATIONS đã tồn tại.
 */
function migrateFieldValidity_(ss) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('FIELDVAL_MIGRATED_V1')) return;
  try {
    var docs = ss.getSheetByName(DB_SHEET_DOCS);
    var lastRow = docs.getLastRow();
    if (lastRow < 2 || docs.getLastColumn() < COLS.RELATIONS + 1) {
      props.setProperty('FIELDVAL_MIGRATED_V1', '1');
      return;
    }
    var n = lastRow - 1;
    var start = parseInt(props.getProperty('FIELDVAL_MIGRATE_CURSOR'), 10) || 0;
    var count = Math.min(ANALYSIS_MIGRATE_BATCH, n - start);
    if (count <= 0) {
      props.setProperty('FIELDVAL_MIGRATED_V1', '1');
      props.deleteProperty('FIELDVAL_MIGRATE_CURSOR');
      return;
    }
    var anaCol = docs.getRange(2 + start, COLS.ANALYSIS + 1, count, 1).getValues();
    var fieldCol = docs.getRange(2 + start, COLS.FIELD + 1, count, 1).getValues();
    var valCol = docs.getRange(2 + start, COLS.VALIDITY + 1, count, 1).getValues();
    for (var i = 0; i < count; i++) {
      if (!String(fieldCol[i][0] || '').trim()) {
        var a = parseAnalysis_(anaCol[i][0]);
        fieldCol[i][0] = a.field || '';
      }
      if (!String(valCol[i][0] || '').trim()) valCol[i][0] = 'Chưa xác định';
    }
    docs.getRange(2 + start, COLS.FIELD + 1, count, 1).setValues(fieldCol);
    docs.getRange(2 + start, COLS.VALIDITY + 1, count, 1).setValues(valCol);
    var next = start + count;
    if (next >= n) {
      props.setProperty('FIELDVAL_MIGRATED_V1', '1');
      props.deleteProperty('FIELDVAL_MIGRATE_CURSOR');
    } else {
      props.setProperty('FIELDVAL_MIGRATE_CURSOR', String(next));
    }
  } catch (e) { Logger.log('migrateFieldValidity_ error: ' + e); }
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
    urgency: cell_(r[COLS.URGENCY]),
    edited: String(r[COLS.EDITED]).toUpperCase() === 'TRUE',
    keywords: cell_(r[COLS.KEYWORDS]),
    analysis: cell_(r[COLS.ANALYSIS]),
    field: cell_(r[COLS.FIELD]),
    validity: cell_(r[COLS.VALIDITY]) || 'Chưa xác định',
    relations: cell_(r[COLS.RELATIONS]),
    procStatus: processingStatus_(cell_(r[COLS.OCR_STATUS]), String(r[COLS.EDITED]).toUpperCase() === 'TRUE')
  };
}

/**
 * Trạng thái xử lý SUY DIỄN từ trạng thái OCR + cờ đã kiểm tra (không lưu riêng).
 */
function processingStatus_(ocrStatus, edited) {
  switch (ocrStatus) {
    case 'pending': return 'Chưa OCR';
    case 'partial': return 'Đang OCR';
    case 'error': return 'Lỗi OCR';
    case 'skip':
    case 'skip-large': return 'File quá lớn';
    default: return edited ? 'Đã kiểm tra' : 'Chưa kiểm tra'; // ok / ok-vision / manual
  }
}

/**
 * Map fileId -> {rowIndex (1-based tuyệt đối trong sheet), modifiedTime}
 */
function getExistingIndex_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  var map = {};
  if (lastRow < 2) return map;
  // Chỉ đọc cột FileId và nhóm cột MODIFIED_TIME..EDITED -> KHÔNG đọc cột nội dung nặng.
  var n = lastRow - 1;
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, n, 1).getValues();
  var meta = sheet.getRange(2, COLS.MODIFIED_TIME + 1, n, COLS.EDITED - COLS.MODIFIED_TIME + 1).getValues();
  var mOff = 0;
  var oOff = COLS.OCR_STATUS - COLS.MODIFIED_TIME;
  var eOff = COLS.EDITED - COLS.MODIFIED_TIME;
  for (var i = 0; i < ids.length; i++) {
    map[ids[i][0]] = {
      rowIndex: i + 2,
      modifiedTime: meta[i][mOff],
      ocrStatus: meta[i][oOff],
      edited: String(meta[i][eOff]).toUpperCase() === 'TRUE'
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
  row[COLS.EDITED] = d.edited ? 'TRUE' : '';
  row[COLS.KEYWORDS] = d.keywords || '';
  row[COLS.ANALYSIS] = d.analysis || '';
  row[COLS.FIELD] = d.field || '';
  row[COLS.VALIDITY] = d.validity || '';
  row[COLS.RELATIONS] = d.relations || '';
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

  // Lĩnh vực: '' = tự động (xoá cờ sửa tay); có giá trị = đặt tay.
  if (p.field != null) {
    if (String(p.field).trim() === '') { cur.fieldManual = false; }
    else { cur.field = String(p.field).trim(); cur.fieldManual = true; }
  }
  // Từ khóa: kwAuto = quay lại tự động; keywords (mảng/chuỗi) = đặt tay.
  if (p.kwAuto) { cur.kwManual = false; }
  else if (p.keywords != null) { cur.keywords = sanitizeKeywords_(p.keywords); cur.kwManual = true; }

  if (p.validity != null) cur.validity = String(p.validity).trim();

  // Quan hệ văn bản (2 chiều): replaces/related do người dùng đặt; replacedBy hệ thống tự quản lý.
  if (p.relations != null) applyRelationsTwoWay_(cur, p.relations, existing);

  // Luôn tính lại hồ sơ phân tích để đồng bộ Lĩnh vực + cờ sửa tay (giữ giá trị đặt tay).
  analyzeAndAttach_(cur);

  // Đánh dấu đã sửa tay (bảo vệ metadata) NHƯNG giữ nguyên ocrStatus để vẫn tiếp tục OCR nội dung.
  cur.edited = true;
  cur.scannedAt = new Date().toISOString();
  upsertDoc_(cur, existing);
  writeLog_('Sửa tay', 1, cur.fileName);
  return cur;
}

/* ===================== QUAN HỆ VĂN BẢN (2 chiều) ===================== */
function parseRelations_(s) {
  var empty = { replaces: [], replacedBy: [], related: [] };
  if (!s) return empty;
  try {
    var o = JSON.parse(s);
    return {
      replaces: Array.isArray(o.replaces) ? o.replaces.map(String) : [],
      replacedBy: Array.isArray(o.replacedBy) ? o.replacedBy.map(String) : [],
      related: Array.isArray(o.related) ? o.related.map(String) : []
    };
  } catch (e) { return empty; }
}
function relationsToString_(o) {
  try {
    return JSON.stringify({ replaces: o.replaces || [], replacedBy: o.replacedBy || [], related: o.related || [] });
  } catch (e) { return ''; }
}
function uniqStr_(arr) {
  var seen = {}, out = [];
  (arr || []).forEach(function (x) { x = String(x); if (x && !seen[x]) { seen[x] = 1; out.push(x); } });
  return out;
}
function removeFrom_(arr, id) {
  return (arr || []).filter(function (x) { return String(x) !== String(id); });
}

/**
 * Đặt quan hệ cho văn bản `cur` và ĐỒNG BỘ 2 CHIỀU sang các văn bản đối tác.
 * req: { replaces:[fileId], related:[fileId] }. replacedBy do hệ thống tự quản lý.
 * Đặt A thay thế B => B nhận replacedBy=A và bị đặt "Hết hiệu lực".
 */
function applyRelationsTwoWay_(cur, req, existing) {
  var prev = parseRelations_(cur.relations);
  req = req || {};
  var self = String(cur.fileId);
  var newReplaces = uniqStr_(req.replaces).filter(function (id) { return id !== self; });
  var newRelated = uniqStr_(req.related).filter(function (id) { return id !== self; });
  cur.relations = relationsToString_({ replaces: newReplaces, replacedBy: prev.replacedBy, related: newRelated });

  syncCounterparts_(self, prev.replaces, newReplaces, existing, 'replacedBy', true);
  syncCounterparts_(self, prev.related, newRelated, existing, 'related', false);
}

function syncCounterparts_(selfId, oldList, newList, existing, counterKey, expire) {
  var newSet = {}; (newList || []).forEach(function (x) { newSet[String(x)] = 1; });
  var oldSet = {}; (oldList || []).forEach(function (x) { oldSet[String(x)] = 1; });
  var added = (newList || []).filter(function (x) { return !oldSet[String(x)]; });
  var removed = (oldList || []).filter(function (x) { return !newSet[String(x)]; });

  added.forEach(function (id) {
    var other = getDocDetailFast_(id); if (!other) return;
    var rel = parseRelations_(other.relations);
    rel[counterKey] = uniqStr_(rel[counterKey].concat([selfId]));
    other.relations = relationsToString_(rel);
    if (expire) other.validity = 'Hết hiệu lực';
    upsertDoc_(other, existing);
  });
  removed.forEach(function (id) {
    var other = getDocDetailFast_(id); if (!other) return;
    var rel = parseRelations_(other.relations);
    rel[counterKey] = removeFrom_(rel[counterKey], selfId);
    other.relations = relationsToString_(rel);
    upsertDoc_(other, existing); // không tự khôi phục hiệu lực (có thể do VB khác thay thế)
  });
}

// Các trường được phép cập nhật hàng loạt (chỉ metadata chung, KHÔNG đụng nội dung/tiêu đề/số).
var BATCH_FIELDS_ = ['docTypeCode', 'issuer', 'issuerLevel', 'field', 'validity'];

/**
 * Cập nhật CÙNG LÚC một tập trường chung cho nhiều văn bản (áp dụng hàng loạt).
 * Đọc sheet 1 lần, sửa trong bộ nhớ, chỉ ghi lại các dòng thay đổi -> tiết kiệm quota.
 * @param {string[]} fileIds Danh sách mã văn bản cần áp dụng.
 * @param {Object} fields Các trường chung: {docTypeCode?, issuer?, issuerLevel?, status?, security?, urgency?}.
 *   Chỉ trường có giá trị (khác rỗng) mới được áp dụng; trường không truyền/rỗng được bỏ qua.
 * @return {{updated: number, requested: number}} Số văn bản đã cập nhật / số yêu cầu.
 */
function updateDocsBatch_(fileIds, fields) {
  if (!fileIds || !fileIds.length) throw new Error('Chưa chọn văn bản nào.');
  fields = fields || {};
  var apply = {};
  BATCH_FIELDS_.forEach(function (k) {
    if (fields[k] != null && String(fields[k]).trim() !== '') apply[k] = String(fields[k]).trim();
  });
  if (!Object.keys(apply).length) throw new Error('Chưa chọn trường nào để áp dụng.');

  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { updated: 0, requested: fileIds.length };
  var n = lastRow - 1;
  var values = sheet.getRange(2, 1, n, DB_HEADERS.length).getValues();

  var want = {};
  fileIds.forEach(function (id) { want[String(id)] = true; });

  var typeName = apply.docTypeCode != null ? getTypeName_(apply.docTypeCode) : null;
  // Đổi đơn vị hoặc đặt lĩnh vực -> tính lại hồ sơ phân tích (giữ lĩnh vực đặt tay).
  var reanalyze = apply.issuer != null || apply.field != null;
  var nowIso = new Date().toISOString();
  var updated = 0;

  for (var i = 0; i < n; i++) {
    if (!want[String(values[i][COLS.FILE_ID])]) continue;
    if (apply.docTypeCode != null) { values[i][COLS.DOC_TYPE_CODE] = apply.docTypeCode; values[i][COLS.DOC_TYPE] = typeName; }
    if (apply.issuer != null) values[i][COLS.ISSUER] = apply.issuer;
    if (apply.issuerLevel != null) values[i][COLS.ISSUER_LEVEL] = apply.issuerLevel;
    if (apply.field != null) values[i][COLS.FIELD] = apply.field;
    if (apply.validity != null) values[i][COLS.VALIDITY] = apply.validity;
    values[i][COLS.EDITED] = 'TRUE';               // bảo vệ metadata khỏi bị ghi đè khi quét lại
    values[i][COLS.SCANNED_AT] = nowIso;
    if (reanalyze) {
      var obj = rowToObj_(values[i]);
      if (apply.field != null) obj.fieldManual = true; // giữ lĩnh vực đặt tay
      analyzeAndAttach_(obj);
      values[i][COLS.KEYWORDS] = obj.keywords || '';
      values[i][COLS.ANALYSIS] = obj.analysis || '';
      values[i][COLS.FIELD] = obj.field || '';
    }
    // Ghi lại đúng dòng vừa sửa (giữ nguyên các dòng khác).
    sheet.getRange(i + 2, 1, 1, DB_HEADERS.length).setValues([values[i]]);
    updated++;
  }
  writeLog_('Sửa hàng loạt', updated, updated + '/' + fileIds.length + ' văn bản');
  return { updated: updated, requested: fileIds.length };
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
