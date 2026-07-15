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
  OCR_STATUS: 13     // 'ok' | 'skip' | 'error'
};

var DB_HEADERS = [
  'FileId', 'Tên file', 'Loại văn bản', 'Mã loại', 'Số/Ký hiệu',
  'Ngày ban hành', 'Trích yếu', 'Nội dung', 'Đường dẫn', 'MimeType',
  'Link Drive', 'Sửa lần cuối', 'Quét lúc', 'OCR'
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
 * Trả về Spreadsheet database; tự tạo nếu chưa có.
 */
function getOrCreateDatabase() {
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
  return ss;
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
    ocrStatus: cell_(r[COLS.OCR_STATUS])
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
  var values = sheet.getRange(2, 1, lastRow - 1, DB_HEADERS.length).getValues();
  for (var i = 0; i < values.length; i++) {
    map[values[i][COLS.FILE_ID]] = {
      rowIndex: i + 2,
      modifiedTime: values[i][COLS.MODIFIED_TIME]
    };
  }
  return map;
}

function docToRow_(d) {
  var row = new Array(DB_HEADERS.length).fill('');
  row[COLS.FILE_ID] = d.fileId;
  row[COLS.FILE_NAME] = d.fileName;
  row[COLS.DOC_TYPE] = d.docType;
  row[COLS.DOC_TYPE_CODE] = d.docTypeCode;
  row[COLS.DOC_NUMBER] = d.docNumber;
  row[COLS.ISSUED_DATE] = d.issuedDate;
  row[COLS.TITLE] = d.title;
  row[COLS.CONTENT] = d.content;
  row[COLS.FOLDER_PATH] = d.folderPath;
  row[COLS.MIME_TYPE] = d.mimeType;
  row[COLS.FILE_URL] = d.fileUrl;
  row[COLS.MODIFIED_TIME] = d.modifiedTime;
  row[COLS.SCANNED_AT] = d.scannedAt;
  row[COLS.OCR_STATUS] = d.ocrStatus;
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

function writeLog_(action, count, note) {
  try {
    var ss = getOrCreateDatabase();
    var log = ss.getSheetByName(DB_SHEET_LOG);
    log.appendRow([new Date(), action, count, note || '']);
  } catch (e) { /* không để log làm hỏng luồng chính */ }
}
