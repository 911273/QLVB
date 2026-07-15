/*************************************************************************
 * QLVB-EPU - FILE MÃ NGUỒN GỘP (dán toàn bộ vào 1 file Code.gs)
 * Hệ thống Quản lý Văn bản - Trường Đại học Điện lực
 * Gồm: Config + Storage + Classifier + Ocr + Scanner + Search + Code
 *************************************************************************/

/* ===================== Config.gs ===================== */
/**
 * Config.gs
 * Cấu hình chung cho Hệ thống Quản lý Văn bản (QLVB) - Trường Đại học Điện lực (EPU).
 *
 * Toàn bộ cấu hình động (Folder ID, Spreadsheet ID...) được lưu trong
 * PropertiesService để mỗi lần deploy không cần sửa code.
 */

// Khoá lưu trong Script Properties
var PROP_ROOT_FOLDER_ID = 'ROOT_FOLDER_ID';   // Folder gốc chứa văn bản trên Drive
var PROP_DB_SPREADSHEET_ID = 'DB_SPREADSHEET_ID'; // Spreadsheet dùng làm database
var PROP_LAST_SCAN = 'LAST_SCAN_AT';          // Thời điểm quét gần nhất
var PROP_DOC_TYPES = 'DOC_TYPES_JSON';        // Danh sách loại VB (JSON) - có thể tuỳ biến

// Tên mặc định
var DEFAULT_ROOT_FOLDER_NAME = 'QLVB-EPU';
var DEFAULT_DB_SPREADSHEET_NAME = 'QLVB-EPU - Cơ sở dữ liệu văn bản';
var DB_SHEET_DOCS = 'VanBan';    // Sheet chứa danh mục văn bản
var DB_SHEET_LOG = 'NhatKy';     // Sheet nhật ký quét

// Ngôn ngữ OCR (Google OCR). 'vi' = Tiếng Việt.
var OCR_LANGUAGE = 'vi';

// Các định dạng file được xử lý
var SUPPORTED_MIME = {
  PDF: 'application/pdf',
  GDOC: 'application/vnd.google-apps.document',
  DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  DOC: 'application/msword',
  PNG: 'image/png',
  JPG: 'image/jpeg',
  JPEG: 'image/jpeg',
  TIFF: 'image/tiff',
  GIF: 'image/gif'
};

// Các mime cần OCR (ảnh + PDF scan)
var OCR_MIME_TYPES = [
  SUPPORTED_MIME.PDF,
  SUPPORTED_MIME.PNG,
  SUPPORTED_MIME.JPG,
  SUPPORTED_MIME.TIFF,
  SUPPORTED_MIME.GIF
];

/**
 * Bộ loại văn bản chuẩn của Trường ĐH Điện lực.
 * keywords: từ khoá (không dấu, chữ thường) xuất hiện trong tên file hoặc nội dung
 *           để tự động phân loại.
 * priority: số nhỏ hơn được ưu tiên khớp trước khi có nhiều loại cùng khớp.
 */
function getDefaultDocTypes() {
  return [
    { code: 'QD',  name: 'Quyết định', priority: 1,
      keywords: ['quyet dinh', 'qĐ', 'so qd', '/qd-', 'qd-dhdl', 'qd/'] },
    { code: 'QDI', name: 'Quy định', priority: 2,
      keywords: ['quy dinh'] },
    { code: 'QT',  name: 'Quy trình', priority: 3,
      keywords: ['quy trinh'] },
    { code: 'TB',  name: 'Thông báo', priority: 4,
      keywords: ['thong bao', '/tb-', 'tb-dhdl', 'so tb'] },
    { code: 'CV',  name: 'Công văn', priority: 5,
      keywords: ['cong van', '/cv-', 'cv-dhdl', 'v/v', 've viec'] },
    { code: 'KH',  name: 'Kế hoạch', priority: 6,
      keywords: ['ke hoach', '/kh-', 'kh-dhdl'] },
    { code: 'TTr', name: 'Tờ trình', priority: 7,
      keywords: ['to trinh', '/ttr-', 'ttr-dhdl'] },
    { code: 'BC',  name: 'Báo cáo', priority: 8,
      keywords: ['bao cao', '/bc-', 'bc-dhdl'] },
    { code: 'HD',  name: 'Hướng dẫn', priority: 9,
      keywords: ['huong dan', '/hd-', 'hd-dhdl'] },
    { code: 'BB',  name: 'Biên bản', priority: 10,
      keywords: ['bien ban', '/bb-', 'bb-dhdl'] },
    { code: 'HDO', name: 'Hợp đồng', priority: 11,
      keywords: ['hop dong', '/hĐ-', 'hd kinh te'] },
    { code: 'GM',  name: 'Giấy mời', priority: 12,
      keywords: ['giay moi', '/gm-'] }
  ];
}

/**
 * Lấy danh sách loại VB hiện tại (ưu tiên cấu hình tuỳ biến trong Properties).
 */
function getDocTypes() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_DOC_TYPES);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.length) return parsed;
    } catch (e) {
      // fallback về mặc định
    }
  }
  return getDefaultDocTypes();
}

/**
 * Lưu danh sách loại VB tuỳ biến.
 */
function saveDocTypes(docTypes) {
  PropertiesService.getScriptProperties()
    .setProperty(PROP_DOC_TYPES, JSON.stringify(docTypes));
  return getDocTypes();
}


/* ===================== Storage.gs ===================== */
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


/* ===================== Classifier.gs ===================== */
/**
 * Classifier.gs
 * Tự động phân loại văn bản + trích xuất số/ký hiệu + ngày ban hành
 * dựa trên tên file và nội dung (OCR/text).
 */

/**
 * Bỏ dấu tiếng Việt, chuyển chữ thường -> phục vụ so khớp từ khoá.
 */
function normalizeVi_(str) {
  if (!str) return '';
  var s = str.toString().toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // bo dau
  s = s.replace(/đ/g, 'd').replace(/Đ/g, 'd');
  return s;
}

/**
 * Phân loại văn bản. Ưu tiên khớp trong TÊN FILE, sau đó tới NỘI DUNG.
 * Trả về {code, name} hoặc loại "Khác" nếu không khớp.
 */
function classifyDoc(fileName, content) {
  var types = getDocTypes().slice().sort(function (a, b) {
    return (a.priority || 99) - (b.priority || 99);
  });
  var nName = normalizeVi_(fileName);
  var nContent = normalizeVi_((content || '').substring(0, 3000)); // chỉ xét phần đầu cho nhanh

  // Vòng 1: khớp theo tên file (đáng tin hơn)
  for (var i = 0; i < types.length; i++) {
    if (matchKeywords_(nName, types[i].keywords)) {
      return { code: types[i].code, name: types[i].name };
    }
  }
  // Vòng 2: khớp theo nội dung
  for (var j = 0; j < types.length; j++) {
    if (matchKeywords_(nContent, types[j].keywords)) {
      return { code: types[j].code, name: types[j].name };
    }
  }
  return { code: 'KHAC', name: 'Khác' };
}

function matchKeywords_(text, keywords) {
  if (!keywords) return false;
  for (var i = 0; i < keywords.length; i++) {
    var kw = normalizeVi_(keywords[i]);
    if (kw && text.indexOf(kw) !== -1) return true;
  }
  return false;
}

/**
 * Trích số/ký hiệu văn bản, ví dụ: "123/QĐ-ĐHĐL", "45/TB-ĐHĐL".
 */
function extractDocNumber(fileName, content) {
  var sources = [fileName || '', (content || '').substring(0, 2000)];
  var re = /(\d{1,5}\s*\/\s*[A-Za-zĐđ]{1,6}(?:\s*-\s*[A-Za-zĐđ.]{1,12})?)/;
  for (var i = 0; i < sources.length; i++) {
    var m = sources[i].match(re);
    if (m) return m[1].replace(/\s+/g, '');
  }
  // fallback: "Số: 123"
  for (var j = 0; j < sources.length; j++) {
    var m2 = sources[j].match(/[Ss]ố[:\s]+(\d{1,5})/);
    if (m2) return m2[1];
  }
  return '';
}

/**
 * Trích ngày ban hành. Ưu tiên:
 *  1) "ngày 05 tháng 07 năm 2024"
 *  2) dd/mm/yyyy hoặc dd-mm-yyyy trong nội dung/tên file
 * Trả về chuỗi 'yyyy-MM-dd' hoặc '' nếu không tìm thấy.
 */
function extractIssuedDate(fileName, content, fallbackDate) {
  var text = (content || '').substring(0, 4000) + ' ' + (fileName || '');

  // 1) ngày ... tháng ... năm ...
  var m1 = text.match(/ng[àa]y\s+(\d{1,2})\s+th[áa]ng\s+(\d{1,2})\s+n[ăa]m\s+(\d{4})/i);
  if (m1) {
    return toIsoDate_(m1[3], m1[2], m1[1]);
  }
  // 2) dd/mm/yyyy | dd-mm-yyyy | dd.mm.yyyy
  var m2 = text.match(/(\b\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})\b/);
  if (m2) {
    return toIsoDate_(m2[3], m2[2], m2[1]);
  }
  // 3) yyyy-mm-dd (đôi khi trong tên file)
  var m3 = text.match(/(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m3) {
    return toIsoDate_(m3[1], m3[2], m3[3]);
  }
  // fallback: ngày tạo file
  if (fallbackDate) {
    return Utilities.formatDate(fallbackDate, 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
  }
  return '';
}

function toIsoDate_(y, m, d) {
  var yy = parseInt(y, 10);
  var mm = parseInt(m, 10);
  var dd = parseInt(d, 10);
  if (isNaN(yy) || isNaN(mm) || isNaN(dd)) return '';
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return '';
  var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
  return yy + '-' + pad(mm) + '-' + pad(dd);
}

/**
 * Trích trích yếu/tiêu đề: dòng đầu tiên có ý nghĩa của nội dung, hoặc tên file.
 */
function extractTitle(fileName, content) {
  if (content) {
    var lines = content.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      // tìm dòng "V/v ..." hoặc dòng đủ dài, không phải quốc hiệu
      if (/^v\/v/i.test(line) || /^về việc/i.test(line)) {
        return line.replace(/\s+/g, ' ').substring(0, 300);
      }
    }
    for (var j = 0; j < lines.length; j++) {
      var l = lines[j].trim();
      if (l.length > 15 && !/cộng hòa|độc lập|tự do|hạnh phúc/i.test(l)) {
        return l.replace(/\s+/g, ' ').substring(0, 300);
      }
    }
  }
  // fallback: bỏ đuôi file
  return (fileName || '').replace(/\.[a-z0-9]+$/i, '');
}


/* ===================== Ocr.gs ===================== */
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


/* ===================== Scanner.gs ===================== */
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

  var stats = { scanned: 0, inserted: 0, updated: 0, skipped: 0, ocr: 0, errors: 0, deleted: 0, limitHit: false };
  var livingIds = {};

  var files = collectFiles_(root, '', []);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    livingIds[f.id] = true;

    var hit = existing[f.id];
    var changed = !hit || Number(hit.modifiedTime) !== Number(f.modifiedTime);

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
  var res = extractContent(f.id, f.mimeType);
  var content = res.text || '';

  var cls = classifyDoc(f.name, content);
  var docNumber = extractDocNumber(f.name, content);
  var issued = extractIssuedDate(f.name, content, f.createdDate);
  var title = extractTitle(f.name, content);

  var doc = {
    fileId: f.id,
    fileName: f.name,
    docType: cls.name,
    docTypeCode: cls.code,
    docNumber: docNumber,
    issuedDate: issued,
    title: title,
    content: content.substring(0, 45000), // giới hạn để không vượt ô Sheets (~50k ký tự)
    folderPath: f.folderPath,
    mimeType: f.mimeType,
    fileUrl: f.url,
    modifiedTime: f.modifiedTime,
    scannedAt: new Date().toISOString(),
    ocrStatus: res.status
  };
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


/* ===================== Search.gs ===================== */
/**
 * Search.gs
 * Tìm kiếm & lọc văn bản trong database.
 */

/**
 * Tìm kiếm văn bản.
 * query: {
 *   keyword: String,        // tìm trong tên, số hiệu, trích yếu, nội dung
 *   typeCode: String,       // lọc theo mã loại VB ('' = tất cả)
 *   fromDate: 'yyyy-MM-dd',
 *   toDate: 'yyyy-MM-dd',
 *   sortBy: 'issuedDate'|'fileName'|'docType',
 *   sortDir: 'asc'|'desc',
 *   page: Number (1-based),
 *   pageSize: Number
 * }
 */
function searchDocs(query) {
  query = query || {};
  var docs = readAllDocs();
  var kw = normalizeVi_(query.keyword || '').trim();
  var terms = kw ? kw.split(/\s+/) : [];

  var filtered = docs.filter(function (d) {
    if (query.typeCode && d.docTypeCode !== query.typeCode) return false;
    if (query.fromDate && (!d.issuedDate || d.issuedDate < query.fromDate)) return false;
    if (query.toDate && (!d.issuedDate || d.issuedDate > query.toDate)) return false;
    if (terms.length) {
      var hay = normalizeVi_([
        d.fileName, d.docNumber, d.title, d.docType, d.content, d.folderPath
      ].join(' \n '));
      for (var i = 0; i < terms.length; i++) {
        if (hay.indexOf(terms[i]) === -1) return false; // AND các từ khoá
      }
    }
    return true;
  });

  // Sắp xếp
  var sortBy = query.sortBy || 'issuedDate';
  var dir = query.sortDir === 'asc' ? 1 : -1;
  filtered.sort(function (a, b) {
    var va = (a[sortBy] || '').toString();
    var vb = (b[sortBy] || '').toString();
    if (va < vb) return -1 * dir;
    if (va > vb) return 1 * dir;
    return 0;
  });

  // Tạo snippet + rút gọn nội dung (không trả full content về client cho nhẹ)
  var results = filtered.map(function (d) {
    return {
      fileId: d.fileId,
      fileName: d.fileName,
      docType: d.docType,
      docTypeCode: d.docTypeCode,
      docNumber: d.docNumber,
      issuedDate: d.issuedDate,
      title: d.title,
      folderPath: d.folderPath,
      mimeType: d.mimeType,
      fileUrl: d.fileUrl,
      ocrStatus: d.ocrStatus,
      snippet: makeSnippet_(d.content, terms)
    };
  });

  // Phân trang
  var page = query.page || 1;
  var pageSize = query.pageSize || 20;
  var total = results.length;
  var start = (page - 1) * pageSize;
  var pageItems = results.slice(start, start + pageSize);

  return {
    total: total,
    page: page,
    pageSize: pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    items: pageItems
  };
}

/**
 * Tạo đoạn trích nội dung quanh từ khoá đầu tiên khớp.
 */
function makeSnippet_(content, terms) {
  if (!content) return '';
  if (!terms || !terms.length) return content.substring(0, 160).replace(/\s+/g, ' ') + '…';
  var nContent = normalizeVi_(content);
  var pos = -1;
  for (var i = 0; i < terms.length; i++) {
    pos = nContent.indexOf(terms[i]);
    if (pos !== -1) break;
  }
  if (pos === -1) return content.substring(0, 160).replace(/\s+/g, ' ') + '…';
  var start = Math.max(0, pos - 60);
  var snippet = content.substring(start, start + 200).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + snippet + '…';
}

/**
 * Lấy chi tiết 1 văn bản (kèm full content).
 */
function getDocDetail(fileId) {
  var docs = readAllDocs();
  for (var i = 0; i < docs.length; i++) {
    if (docs[i].fileId === fileId) return docs[i];
  }
  return null;
}


/* ===================== Code.gs ===================== */
/**
 * Code.gs
 * Điểm vào của Web App + các hàm API được giao diện gọi qua google.script.run.
 *
 * Hệ thống Quản lý Văn bản (QLVB) - Trường Đại học Điện lực (EPU).
 */

/**
 * Phục vụ giao diện web.
 */
function doGet(e) {
  var tpl = HtmlService.createTemplateFromFile('Index');
  return tpl.evaluate()
    .setTitle('QLVB - Đại học Điện lực')
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.ico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Cho phép nhúng file HTML con (CSS/JS) vào Index.
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/* ============================ API ============================ */

/**
 * Trạng thái hệ thống cho giao diện (khởi tạo lần đầu, folder, DB...).
 */
function apiGetStatus() {
  var props = PropertiesService.getScriptProperties();
  var rootId = props.getProperty(PROP_ROOT_FOLDER_ID);
  var dbId = props.getProperty(PROP_DB_SPREADSHEET_ID);
  var lastScan = props.getProperty(PROP_LAST_SCAN);

  var rootFolder = null, dbFile = null;
  if (rootId) {
    try {
      var rf = DriveApp.getFolderById(rootId);
      rootFolder = { id: rootId, name: rf.getName(), url: rf.getUrl() };
    } catch (e) { rootFolder = null; }
  }
  if (dbId) {
    try {
      var db = DriveApp.getFileById(dbId);
      dbFile = { id: dbId, name: db.getName(), url: db.getUrl() };
    } catch (e) { dbFile = null; }
  }

  return {
    initialized: !!(rootId && dbId),
    rootFolder: rootFolder,
    database: dbFile,
    lastScan: lastScan,
    autoScan: hasAutoScanTrigger(),
    docTypes: getDocTypes(),
    totalDocs: countDocs_(),
    userEmail: Session.getActiveUser().getEmail()
  };
}

function countDocs_() {
  try {
    var sheet = getDocsSheet_();
    return Math.max(0, sheet.getLastRow() - 1);
  } catch (e) { return 0; }
}

/**
 * Khởi tạo hệ thống: tạo folder gốc + database. Gọi 1 lần khi lần đầu dùng.
 */
function apiInitialize() {
  getOrCreateRootFolder();
  getOrCreateDatabase();
  writeLog_('Khởi tạo hệ thống', 0, 'Tạo folder gốc và cơ sở dữ liệu');
  return apiGetStatus();
}

/**
 * Quét & cập nhật Drive.
 */
function apiScan(force) {
  return scanDrive({ force: !!force });
}

/**
 * Tìm kiếm.
 */
function apiSearch(query) {
  return searchDocs(query);
}

/**
 * Chi tiết văn bản.
 */
function apiGetDetail(fileId) {
  return getDocDetail(fileId);
}

/**
 * Thống kê theo loại VB và theo năm (cho trang tổng quan).
 */
function apiGetStats() {
  var docs = readAllDocs();
  var byType = {};
  var byYear = {};
  var typeNames = {};
  getDocTypes().forEach(function (t) { typeNames[t.code] = t.name; });

  docs.forEach(function (d) {
    var code = d.docTypeCode || 'KHAC';
    byType[code] = (byType[code] || 0) + 1;
    var year = (d.issuedDate || '').substring(0, 4) || 'Không rõ';
    byYear[year] = (byYear[year] || 0) + 1;
  });

  var typeStats = Object.keys(byType).map(function (code) {
    return { code: code, name: typeNames[code] || (code === 'KHAC' ? 'Khác' : code), count: byType[code] };
  }).sort(function (a, b) { return b.count - a.count; });

  var yearStats = Object.keys(byYear).map(function (y) {
    return { year: y, count: byYear[y] };
  }).sort(function (a, b) { return a.year < b.year ? 1 : -1; });

  return { total: docs.length, byType: typeStats, byYear: yearStats };
}

/**
 * OCR lại 1 văn bản.
 */
function apiReOcr(fileId) {
  return reOcrDoc(fileId);
}

/**
 * Bật/tắt tự động quét.
 */
function apiSetAutoScan(enable, hours) {
  if (enable) return { ok: true, message: installAutoScanTrigger(hours || 6), autoScan: true };
  var n = removeAutoScanTrigger();
  return { ok: true, message: 'Đã tắt tự động quét (' + n + ' trigger).', autoScan: false };
}

/**
 * Lưu danh sách loại văn bản tuỳ biến.
 */
function apiSaveDocTypes(docTypes) {
  return saveDocTypes(docTypes);
}

/**
 * Đặt lại loại VB về mặc định.
 */
function apiResetDocTypes() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_DOC_TYPES);
  return getDocTypes();
}

/**
 * Trả link mở folder gốc để người dùng tải văn bản lên.
 */
function apiGetUploadInfo() {
  var folder = getOrCreateRootFolder();
  return { folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName() };
}


