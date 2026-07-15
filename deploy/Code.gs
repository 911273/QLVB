/*************************************************************************
 * QLVB-EPU - FILE MÃ NGUỒN GỘP (dán toàn bộ vào 1 file Code.gs)
 * Hệ thống Quản lý Văn bản - Trường Đại học Điện lực
 * Gồm: Config Storage Classifier Issuer Vision Ocr OcrQueue Scanner Search Auth Code
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

// ===== OCR nâng cao bằng Google Cloud Vision API (chất lượng tiếng Việt cao) =====
// API key được lưu trong Script Properties (khoá dưới đây), nhập ở màn hình Cài đặt.
var PROP_VISION_API_KEY = 'VISION_API_KEY';
// Gợi ý ngôn ngữ cho Vision (giúp nhận dạng dấu tiếng Việt chính xác hơn).
var VISION_LANGUAGE_HINTS = ['vi', 'en'];
// Số trang tối đa mỗi PDF khi OCR đồng bộ qua Vision (giới hạn của files:annotate là 5).
var VISION_PDF_MAX_PAGES = 5;
// Không gửi lên Vision nếu file lớn hơn mức này (giới hạn kích thước request ~ dưới 20MB).
var VISION_MAX_BYTES = 18 * 1024 * 1024;

// ===== Hàng đợi OCR (xử lý dần để tránh vượt hạn mức miễn phí của Google) =====
var OCR_QUEUE_BATCH_FILES = 5;      // Số văn bản xử lý mỗi lượt chạy hàng đợi.
var OCR_VISION_PAGES_PER_RUN = 5;   // Số trang OCR mỗi văn bản mỗi lượt (Vision tối đa 5).
var DEFAULT_OCR_DAILY_LIMIT = 200;  // Hạn mức số trang OCR bằng Vision mỗi ngày (mặc định).
var PROP_OCR_DAILY_LIMIT = 'OCR_DAILY_LIMIT';
var PROP_OCR_USED_DATE = 'OCR_USED_DATE';
var PROP_OCR_USED_COUNT = 'OCR_USED_COUNT';

function getOcrDailyLimit() {
  var v = parseInt(PropertiesService.getScriptProperties().getProperty(PROP_OCR_DAILY_LIMIT), 10);
  return (v && v > 0) ? v : DEFAULT_OCR_DAILY_LIMIT;
}
function setOcrDailyLimit(n) {
  n = parseInt(n, 10);
  if (!n || n < 0) n = DEFAULT_OCR_DAILY_LIMIT;
  PropertiesService.getScriptProperties().setProperty(PROP_OCR_DAILY_LIMIT, String(n));
  return getOcrDailyLimit();
}
function todayKey_() {
  return Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyy-MM-dd');
}
function ocrUsedToday_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(PROP_OCR_USED_DATE) !== todayKey_()) return 0;
  return parseInt(props.getProperty(PROP_OCR_USED_COUNT), 10) || 0;
}
function ocrBudgetRemaining_() {
  return Math.max(0, getOcrDailyLimit() - ocrUsedToday_());
}
function ocrConsume_(pages) {
  if (!pages || pages <= 0) return;
  var props = PropertiesService.getScriptProperties();
  var used = (props.getProperty(PROP_OCR_USED_DATE) === todayKey_())
    ? (parseInt(props.getProperty(PROP_OCR_USED_COUNT), 10) || 0) : 0;
  props.setProperty(PROP_OCR_USED_DATE, todayKey_());
  props.setProperty(PROP_OCR_USED_COUNT, String(used + pages));
}

// Kích thước tối đa (byte) cho phép OCR. File lớn hơn sẽ bị bỏ qua OCR
// (vì Google OCR dễ thất bại/timeout với PDF scan rất lớn) nhưng VẪN được lập chỉ mục
// dựa trên tên file. Mặc định 15 MB. PDF nhiều trang nên tách nhỏ để OCR được.
var MAX_OCR_BYTES = 15 * 1024 * 1024;

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
 * Tra tên loại VB theo mã. Trả về 'Khác' nếu không tìm thấy.
 */
function getTypeName_(code) {
  if (!code) return 'Khác';
  var types = getDocTypes();
  for (var i = 0; i < types.length; i++) {
    if (types[i].code === code) return types[i].name;
  }
  return code === 'KHAC' ? 'Khác' : code;
}

/**
 * Lưu danh sách loại VB tuỳ biến.
 */
function saveDocTypes(docTypes) {
  PropertiesService.getScriptProperties()
    .setProperty(PROP_DOC_TYPES, JSON.stringify(docTypes));
  return getDocTypes();
}

/* ===================== ĐƠN VỊ / CẤP BAN HÀNH ===================== */

var PROP_ISSUERS = 'ISSUERS_JSON';

// Các cấp ban hành (từ cao xuống thấp). rank càng lớn = càng cụ thể/nội bộ,
// dùng để chọn đơn vị ban hành cụ thể nhất khi văn bản nhắc tới nhiều cấp.
function getIssuerLevels() {
  return ['Chính phủ', 'Bộ/Ngành', 'Trường', 'Khoa', 'Phòng/Ban', 'Trung tâm', 'Khác'];
}
function getLevelRank_(level) {
  var r = {
    'Chính phủ': 1, 'Bộ/Ngành': 2, 'Trường': 3,
    'Khoa': 4, 'Phòng/Ban': 4, 'Trung tâm': 4, 'Khác': 0
  };
  return r[level] || 0;
}

/**
 * Danh mục đơn vị ban hành mặc định (có thể tuỳ biến trong Cài đặt).
 * keywords: từ khoá (không dấu, thường) để tự nhận diện từ nội dung/tên file.
 */
function getDefaultIssuers() {
  return [
    { name: 'Chính phủ', level: 'Chính phủ', keywords: ['chinh phu', 'thu tuong chinh phu'] },
    { name: 'Quốc hội', level: 'Chính phủ', keywords: ['quoc hoi'] },
    { name: 'Bộ Giáo dục và Đào tạo', level: 'Bộ/Ngành', keywords: ['bo giao duc', 'giao duc va dao tao', 'bgd&dt', 'bgddt'] },
    { name: 'Bộ Công Thương', level: 'Bộ/Ngành', keywords: ['bo cong thuong'] },
    { name: 'Bộ Lao động - Thương binh và Xã hội', level: 'Bộ/Ngành', keywords: ['lao dong', 'thuong binh va xa hoi'] },
    { name: 'Trường Đại học Điện lực', level: 'Trường', keywords: ['dai hoc dien luc', 'truong dai hoc dien luc', 'dhdl', 'epu'] },
    { name: 'Phòng Đào tạo', level: 'Phòng/Ban', keywords: ['phong dao tao'] },
    { name: 'Phòng Tổ chức - Hành chính', level: 'Phòng/Ban', keywords: ['to chuc hanh chinh', 'phong tccb', 'to chuc can bo'] },
    { name: 'Phòng Khoa học Công nghệ', level: 'Phòng/Ban', keywords: ['khoa hoc cong nghe', 'phong khcn'] },
    { name: 'Phòng Công tác Sinh viên', level: 'Phòng/Ban', keywords: ['cong tac sinh vien', 'phong ctsv'] },
    { name: 'Khoa Công nghệ Thông tin', level: 'Khoa', keywords: ['khoa cong nghe thong tin', 'khoa cntt'] },
    { name: 'Khoa Điện', level: 'Khoa', keywords: ['khoa dien'] },
    { name: 'Khoa Kinh tế và Quản lý', level: 'Khoa', keywords: ['khoa kinh te', 'kinh te va quan ly'] }
  ];
}

function getIssuers() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_ISSUERS);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.length) return parsed;
    } catch (e) { /* fallback */ }
  }
  return getDefaultIssuers();
}

function saveIssuers(issuers) {
  PropertiesService.getScriptProperties()
    .setProperty(PROP_ISSUERS, JSON.stringify(issuers));
  return getIssuers();
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
  OCR_STATUS: 13,    // 'ok' | 'ok-vision' | 'manual' | 'pending' | 'partial' | 'skip' | 'skip-large' | 'error'
  ISSUER: 14,        // Đơn vị ban hành (tên)
  ISSUER_LEVEL: 15,  // Cấp ban hành (Chính phủ, Bộ/Ngành, Trường, Khoa, Phòng/Ban...)
  OCR_PROGRESS: 16   // Tiến độ OCR dạng 'done/total' (số trang đã OCR / tổng số trang)
};

var DB_HEADERS = [
  'FileId', 'Tên file', 'Loại văn bản', 'Mã loại', 'Số/Ký hiệu',
  'Ngày ban hành', 'Trích yếu', 'Nội dung', 'Đường dẫn', 'MimeType',
  'Link Drive', 'Sửa lần cuối', 'Quét lúc', 'OCR',
  'Đơn vị ban hành', 'Cấp ban hành', 'OCR tiến độ'
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
  migrateIssuedDates_(ss); // chuyển ngày cũ (dạng chữ) sang ngày thật để hiển thị dd/mm/yyyy
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
  // Định dạng cột "Ngày ban hành" hiển thị dd/mm/yyyy (áp dụng cho toàn cột).
  try {
    docs.getRange(2, COLS.ISSUED_DATE + 1, Math.max(1, docs.getMaxRows() - 1), 1)
        .setNumberFormat('dd/mm/yyyy');
  } catch (e) { /* bỏ qua nếu không đặt được */ }
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
    ocrStatus: cell_(r[COLS.OCR_STATUS]),
    issuer: cell_(r[COLS.ISSUER]),
    issuerLevel: cell_(r[COLS.ISSUER_LEVEL]),
    ocrProgress: cell_(r[COLS.OCR_PROGRESS])
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
      modifiedTime: values[i][COLS.MODIFIED_TIME],
      ocrStatus: values[i][COLS.OCR_STATUS]
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
  var docs = readAllDocs();
  var existing = getExistingIndex_();
  var cur = null;
  for (var i = 0; i < docs.length; i++) {
    if (docs[i].fileId === p.fileId) { cur = docs[i]; break; }
  }
  if (!cur) throw new Error('Không tìm thấy văn bản trong cơ sở dữ liệu.');

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

  cur.ocrStatus = 'manual';
  cur.scannedAt = new Date().toISOString();
  upsertDoc_(cur, existing);
  writeLog_('Sửa tay', 1, cur.fileName);
  return cur;
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
  s = s.replace(/[_]+/g, ' ');   // gach duoi -> khoang trang (khop ten file de hon)
  return s;
}

/**
 * Bảng mã ký hiệu văn bản (viết tắt hay gặp) -> mã loại trong hệ thống.
 * Dùng để nhận diện loại ngay từ ký hiệu trong TÊN FILE, ví dụ: 2737TB, 510QĐ, 1258/QĐ-ĐHĐL.
 */
function getCodeMap_() {
  return {
    'QD': 'QD', 'TB': 'TB', 'CV': 'CV', 'KH': 'KH', 'TTR': 'TTr',
    'BC': 'BC', 'HD': 'HD', 'QT': 'QT', 'GM': 'GM', 'BB': 'BB', 'HDO': 'HDO'
  };
}

/**
 * Nhận diện loại + số hiệu từ TÊN FILE với các dạng:
 *   "2737TB...", "510QD...", "1258QD..."  (số dính mã)
 *   "123/QĐ-ĐHĐL", "45/TB-ĐHĐL"           (số/mã-cơ quan)
 *   "TB 2737", "QĐ-510"                    (mã trước số)
 * Trả về { code, number } hoặc null.
 */
function detectFromFileName_(fileName) {
  if (!fileName) return null;
  var base = normalizeVi_(fileName.replace(/\.[a-z0-9]+$/i, '')); // bỏ đuôi + bỏ dấu
  var map = getCodeMap_();

  // 1) số/ký hiệu: 123/qd-...
  var m = base.match(/(\d{1,5})\s*\/\s*([a-z]{2,4})/);
  if (m && map[m[2].toUpperCase()]) return { code: map[m[2].toUpperCase()], number: m[1] };

  // 2) số dính mã ở đầu: 2737tb, 510qd
  m = base.match(/(?:^|\s)(\d{1,5})\s*([a-z]{2,4})\b/);
  if (m && map[m[2].toUpperCase()]) return { code: map[m[2].toUpperCase()], number: m[1] };

  // 3) mã trước số: tb 2737, qd-510
  m = base.match(/(?:^|\s)([a-z]{2,4})\s*[-\s]?\s*(\d{1,5})\b/);
  if (m && map[m[1].toUpperCase()]) return { code: map[m[1].toUpperCase()], number: m[2] };

  return null;
}

/**
 * Phân loại văn bản. Ưu tiên: ký hiệu trong TÊN FILE -> từ khoá TÊN FILE -> NỘI DUNG.
 * Trả về {code, name} hoặc loại "Khác" nếu không khớp.
 */
function classifyDoc(fileName, content) {
  var types = getDocTypes().slice().sort(function (a, b) {
    return (a.priority || 99) - (b.priority || 99);
  });
  var byCode = {};
  types.forEach(function (t) { byCode[t.code] = t; });

  // Vòng 0: nhận diện theo ký hiệu trong tên file (đáng tin nhất cho VB hành chính)
  var det = detectFromFileName_(fileName);
  if (det && byCode[det.code]) {
    return { code: det.code, name: byCode[det.code].name };
  }

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
  // Ưu tiên nhận diện từ ký hiệu trong tên file (2737TB, 510QĐ, 123/QĐ-ĐHĐL...)
  var det = detectFromFileName_(fileName);
  if (det && det.number) {
    var codeUpper = det.code === 'TTr' ? 'TTr' : det.code;
    return det.number + '/' + codeUpper + '-ĐHĐL';
  }
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


/* ===================== Issuer.gs ===================== */
/**
 * Issuer.gs
 * Nhận diện ĐƠN VỊ BAN HÀNH + CẤP BAN HÀNH từ tên file và nội dung văn bản.
 *
 * Văn bản hành chính thường ghi cơ quan cấp trên rồi tới đơn vị ban hành, ví dụ:
 *   "BỘ CÔNG THƯƠNG / TRƯỜNG ĐẠI HỌC ĐIỆN LỰC".
 * Vì vậy khi nhiều cấp cùng xuất hiện, ta chọn đơn vị ở CẤP CỤ THỂ NHẤT (rank cao nhất).
 */
function detectIssuer_(fileName, content) {
  var hay = normalizeVi_((content || '').substring(0, 2500) + ' \n ' + (fileName || ''));
  var issuers = getIssuers();

  var best = null;   // {name, level, rank}
  for (var i = 0; i < issuers.length; i++) {
    var it = issuers[i];
    if (matchKeywords_(hay, it.keywords)) {
      var rank = getLevelRank_(it.level);
      if (!best || rank > best.rank) {
        best = { name: it.name, level: it.level, rank: rank };
      }
    }
  }
  if (best) return { name: best.name, level: best.level };
  return { name: '', level: '' };
}


/* ===================== Vision.gs ===================== */
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
  var docs = readAllDocs();
  var existing = getExistingIndex_();
  var current = null;
  for (var i = 0; i < docs.length; i++) {
    if (docs[i].fileId === fileId) { current = docs[i]; break; }
  }
  if (!current) throw new Error('Không tìm thấy văn bản trong CSDL.');

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


/* ===================== OcrQueue.gs ===================== */
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

// Đếm số văn bản đang chờ OCR.
function ocrQueueCount() {
  var docs = readAllDocs();
  var n = 0;
  for (var i = 0; i < docs.length; i++) if (needsOcr_(docs[i])) n++;
  return n;
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

  var stats = { scanned: 0, inserted: 0, updated: 0, skipped: 0, ocr: 0, queued: 0, errors: 0, deleted: 0, limitHit: false };
  var livingIds = {};

  var files = collectFiles_(root, '', []);
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    livingIds[f.id] = true;

    var hit = existing[f.id];

    // Giữ nguyên văn bản đã sửa tay (kể cả khi quét lại toàn bộ) để không mất chỉnh sửa.
    if (hit && hit.ocrStatus === 'manual') {
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
    ocrProgress: ocrProgress
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

  var issuerKw = normalizeVi_(query.issuer || '').trim();
  var numberKw = normalizeVi_(query.docNumber || '').trim();

  var filtered = docs.filter(function (d) {
    if (query.typeCode && d.docTypeCode !== query.typeCode) return false;
    if (query.issuerLevel && d.issuerLevel !== query.issuerLevel) return false;
    if (issuerKw && normalizeVi_(d.issuer || '').indexOf(issuerKw) === -1) return false;
    if (numberKw && normalizeVi_(d.docNumber || '').indexOf(numberKw) === -1) return false;
    if (query.fromDate && (!d.issuedDate || d.issuedDate < query.fromDate)) return false;
    if (query.toDate && (!d.issuedDate || d.issuedDate > query.toDate)) return false;
    if (terms.length) {
      var hay = normalizeVi_([
        d.fileName, d.docNumber, d.title, d.docType, d.content, d.folderPath,
        d.issuer, d.issuerLevel
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
      issuer: d.issuer,
      issuerLevel: d.issuerLevel,
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


/* ===================== Auth.gs ===================== */
/**
 * Auth.gs
 * Quản lý tài khoản, đăng nhập, phân quyền (RBAC) cho hệ thống QLVB.
 *
 * - Mật khẩu lưu dưới dạng băm SHA-256 kèm salt (không lưu mật khẩu gốc).
 * - Phiên đăng nhập dùng token có chữ ký HMAC-SHA256 (không cần lưu trạng thái).
 * - Tài khoản quản trị mặc định: vupq@epu.edu.vn / 123456 (đổi được sau khi đăng nhập).
 *
 * Toàn bộ hàm thao tác tài khoản đều "private" (kết thúc bằng _) nên KHÔNG gọi trực tiếp
 * được từ giao diện; chỉ đi qua apiDispatch sau khi đã xác thực + kiểm tra quyền.
 */

var ACC_SHEET = 'TaiKhoan';
var ACC_HEADERS = ['Email', 'Mật khẩu (hash)', 'Salt', 'Vai trò', 'Quyền (JSON)', 'Tên hiển thị', 'Kích hoạt', 'Tạo lúc'];
var ACC = { EMAIL: 0, HASH: 1, SALT: 2, ROLE: 3, PERMS: 4, NAME: 5, ACTIVE: 6, CREATED: 7 };

var DEFAULT_ADMIN_EMAIL = 'vupq@epu.edu.vn';
var DEFAULT_ADMIN_PASSWORD = '123456';

// Các quyền chức năng.
var PERM_KEYS = ['view', 'edit', 'scan', 'config', 'accounts'];
var PERM_LABELS = {
  view: 'Xem & tìm kiếm',
  edit: 'Sửa thông tin văn bản',
  scan: 'Quét & OCR',
  config: 'Cấu hình (loại VB, đơn vị, OCR...)',
  accounts: 'Quản lý tài khoản'
};

function rolePerms_(role) {
  if (role === 'admin') return { view: true, edit: true, scan: true, config: true, accounts: true };
  if (role === 'editor') return { view: true, edit: true, scan: true, config: false, accounts: false };
  return { view: true, edit: false, scan: false, config: false, accounts: false }; // viewer
}

function normalizePerms_(role, perms) {
  if (role === 'admin') return rolePerms_('admin'); // admin luôn full quyền
  var base = perms || rolePerms_(role || 'viewer');
  var out = {};
  PERM_KEYS.forEach(function (k) { out[k] = !!base[k]; });
  out.view = true; // ai đăng nhập cũng xem được
  return out;
}

/* ===================== Sheet tài khoản ===================== */
function getAccountsSheet_() {
  var ss = getOrCreateDatabase();
  var sh = ss.getSheetByName(ACC_SHEET);
  if (!sh) {
    sh = ss.insertSheet(ACC_SHEET);
    sh.getRange(1, 1, 1, ACC_HEADERS.length).setValues([ACC_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, ACC_HEADERS.length).setFontWeight('bold')
      .setBackground('#0B5394').setFontColor('#ffffff');
  }
  // Tạo admin mặc định nếu chưa có tài khoản nào.
  if (sh.getLastRow() < 2) {
    createAccountRow_(sh, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD, 'admin',
      rolePerms_('admin'), 'Quản trị viên', true);
  }
  return sh;
}

function createAccountRow_(sh, email, password, role, perms, name, active) {
  var salt = Utilities.getUuid();
  sh.appendRow([
    email.toLowerCase().trim(),
    hashPassword_(password, salt),
    salt,
    role,
    JSON.stringify(normalizePerms_(role, perms)),
    name || '',
    active ? 'TRUE' : 'FALSE',
    new Date().toISOString()
  ]);
}

function findAccountRow_(sh, email) {
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return -1;
  var emails = sh.getRange(2, ACC.EMAIL + 1, lastRow - 1, 1).getValues();
  var target = String(email).toLowerCase().trim();
  for (var i = 0; i < emails.length; i++) {
    if (String(emails[i][0]).toLowerCase().trim() === target) return i + 2;
  }
  return -1;
}

function rowToAccount_(r) {
  var perms;
  try { perms = JSON.parse(r[ACC.PERMS]); } catch (e) { perms = null; }
  return {
    email: String(r[ACC.EMAIL]).toLowerCase().trim(),
    hash: r[ACC.HASH],
    salt: r[ACC.SALT],
    role: r[ACC.ROLE] || 'viewer',
    perms: normalizePerms_(r[ACC.ROLE], perms),
    name: r[ACC.NAME] || '',
    active: String(r[ACC.ACTIVE]).toUpperCase() === 'TRUE'
  };
}

function getAccountByEmail_(email) {
  var sh = getAccountsSheet_();
  var row = findAccountRow_(sh, email);
  if (row === -1) return null;
  var r = sh.getRange(row, 1, 1, ACC_HEADERS.length).getValues()[0];
  var acc = rowToAccount_(r);
  acc._row = row;
  return acc;
}

function publicAccount_(acc) {
  return { email: acc.email, name: acc.name, role: acc.role, active: acc.active, perms: acc.perms };
}

function countActiveAdmins_() {
  var sh = getAccountsSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  var vals = sh.getRange(2, 1, lastRow - 1, ACC_HEADERS.length).getValues();
  var n = 0;
  for (var i = 0; i < vals.length; i++) {
    if (vals[i][ACC.ROLE] === 'admin' && String(vals[i][ACC.ACTIVE]).toUpperCase() === 'TRUE') n++;
  }
  return n;
}

/* ===================== Mật khẩu & token ===================== */
function toHex_(bytes) {
  return bytes.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}
function hashPassword_(password, salt) {
  return toHex_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, salt + '::' + password, Utilities.Charset.UTF_8));
}

function getAuthSecret_() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('AUTH_SECRET');
  if (!s) { s = Utilities.getUuid() + Utilities.getUuid(); props.setProperty('AUTH_SECRET', s); }
  return s;
}
function authErr_() { return new Error('AUTH: Phiên đăng nhập hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.'); }

function signToken_(email) {
  var exp = Date.now() + 8 * 3600 * 1000; // 8 giờ
  var payload = Utilities.base64EncodeWebSafe(email + '|' + exp);
  var sig = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, getAuthSecret_()));
  return payload + '.' + sig;
}
function verifyToken_(token) {
  if (!token) throw authErr_();
  var parts = String(token).split('.');
  if (parts.length !== 2) throw authErr_();
  var expected = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], getAuthSecret_()));
  if (expected !== parts[1]) throw authErr_();
  var decoded = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  var seg = decoded.split('|');
  var email = seg[0], exp = parseInt(seg[1], 10);
  if (!exp || Date.now() > exp) throw authErr_();
  return email;
}

function authVerify_(token) {
  var email = verifyToken_(token);
  var acc = getAccountByEmail_(email);
  if (!acc || !acc.active) throw authErr_();
  return acc;
}

/* ===================== Đăng nhập / đổi mật khẩu ===================== */
function authLogin_(email, password) {
  getAccountsSheet_(); // đảm bảo có admin mặc định
  var acc = getAccountByEmail_(email);
  if (!acc || !acc.active) throw new Error('Email không tồn tại hoặc đã bị khoá.');
  if (hashPassword_(password, acc.salt) !== acc.hash) throw new Error('Sai mật khẩu.');
  return { token: signToken_(acc.email), account: publicAccount_(acc) };
}

function changePassword_(acc, oldPassword, newPassword) {
  var fresh = getAccountByEmail_(acc.email);
  if (!fresh) throw new Error('Không tìm thấy tài khoản.');
  if (hashPassword_(oldPassword, fresh.salt) !== fresh.hash) throw new Error('Mật khẩu hiện tại không đúng.');
  if (!newPassword || newPassword.length < 6) throw new Error('Mật khẩu mới phải từ 6 ký tự trở lên.');
  var sh = getAccountsSheet_();
  var newSalt = Utilities.getUuid();
  sh.getRange(fresh._row, ACC.SALT + 1).setValue(newSalt);
  sh.getRange(fresh._row, ACC.HASH + 1).setValue(hashPassword_(newPassword, newSalt));
  return { ok: true };
}

/* ===================== Quản lý tài khoản (chỉ admin) ===================== */
function listAccounts_() {
  var sh = getAccountsSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var vals = sh.getRange(2, 1, lastRow - 1, ACC_HEADERS.length).getValues();
  return vals.map(function (r) {
    var a = rowToAccount_(r);
    return publicAccount_(a);
  });
}

/**
 * Tạo mới hoặc cập nhật tài khoản.
 * p: { email, name, role, perms, password (bắt buộc khi tạo mới), active }
 */
function saveAccount_(p) {
  if (!p || !p.email) throw new Error('Thiếu email.');
  var email = String(p.email).toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Email không hợp lệ.');
  var role = (p.role === 'admin' || p.role === 'editor' || p.role === 'viewer') ? p.role : 'viewer';
  var perms = normalizePerms_(role, p.perms);
  var active = p.active !== false;

  var sh = getAccountsSheet_();
  var row = findAccountRow_(sh, email);

  if (row === -1) {
    if (!p.password || p.password.length < 6) throw new Error('Mật khẩu tạo mới phải từ 6 ký tự.');
    createAccountRow_(sh, email, p.password, role, perms, p.name || '', active);
    return { ok: true, created: true };
  }

  // Cập nhật: chặn hạ quyền/khoá admin cuối cùng.
  var cur = rowToAccount_(sh.getRange(row, 1, 1, ACC_HEADERS.length).getValues()[0]);
  var losingAdmin = (cur.role === 'admin' && cur.active) && (role !== 'admin' || !active);
  if (losingAdmin && countActiveAdmins_() <= 1) {
    throw new Error('Không thể hạ quyền/khoá quản trị viên cuối cùng.');
  }
  sh.getRange(row, ACC.ROLE + 1).setValue(role);
  sh.getRange(row, ACC.PERMS + 1).setValue(JSON.stringify(perms));
  sh.getRange(row, ACC.NAME + 1).setValue(p.name || cur.name);
  sh.getRange(row, ACC.ACTIVE + 1).setValue(active ? 'TRUE' : 'FALSE');
  if (p.password) {
    if (p.password.length < 6) throw new Error('Mật khẩu phải từ 6 ký tự.');
    var newSalt = Utilities.getUuid();
    sh.getRange(row, ACC.SALT + 1).setValue(newSalt);
    sh.getRange(row, ACC.HASH + 1).setValue(hashPassword_(p.password, newSalt));
  }
  return { ok: true, updated: true };
}

function adminResetPassword_(email, newPassword) {
  if (!newPassword || newPassword.length < 6) throw new Error('Mật khẩu mới phải từ 6 ký tự.');
  var sh = getAccountsSheet_();
  var row = findAccountRow_(sh, email);
  if (row === -1) throw new Error('Không tìm thấy tài khoản.');
  var newSalt = Utilities.getUuid();
  sh.getRange(row, ACC.SALT + 1).setValue(newSalt);
  sh.getRange(row, ACC.HASH + 1).setValue(hashPassword_(newPassword, newSalt));
  return { ok: true };
}

function deleteAccount_(email, currentEmail) {
  var sh = getAccountsSheet_();
  var row = findAccountRow_(sh, email);
  if (row === -1) throw new Error('Không tìm thấy tài khoản.');
  var target = String(email).toLowerCase().trim();
  if (target === String(currentEmail).toLowerCase().trim()) {
    throw new Error('Không thể tự xoá tài khoản đang đăng nhập.');
  }
  var cur = rowToAccount_(sh.getRange(row, 1, 1, ACC_HEADERS.length).getValues()[0]);
  if (cur.role === 'admin' && cur.active && countActiveAdmins_() <= 1) {
    throw new Error('Không thể xoá quản trị viên cuối cùng.');
  }
  sh.deleteRow(row);
  return { ok: true };
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

/* ============================ ĐIỀU PHỐI + PHÂN QUYỀN ============================ */

// Bản đồ chức năng -> quyền cần có. null = chỉ cần đăng nhập.
var METHOD_PERM = {
  login: 'PUBLIC',
  getStatus: null, changePassword: null, logout: null,
  search: 'view', getDetail: 'view', getStats: 'view', getUploadInfo: 'view',
  updateDoc: 'edit', reOcr: 'edit',
  scan: 'scan', ocrQueueRun: 'scan', setOcrAuto: 'scan', setOcrLimit: 'scan', setAutoScan: 'scan',
  saveDocTypes: 'config', resetDocTypes: 'config', saveIssuers: 'config', resetIssuers: 'config',
  setVisionKey: 'config', testVision: 'config', initialize: 'config',
  listAccounts: 'accounts', saveAccount: 'accounts', deleteAccount: 'accounts', resetPassword: 'accounts'
};

/**
 * Điểm vào DUY NHẤT cho giao diện. Xác thực token + kiểm tra quyền rồi mới thực thi.
 */
function apiDispatch(token, method, payload) {
  payload = payload || {};
  if (method === 'login') return authLogin_(payload.email, payload.password);

  var acc = authVerify_(token); // ném lỗi AUTH nếu token sai/hết hạn
  if (!METHOD_PERM.hasOwnProperty(method)) throw new Error('Chức năng không hợp lệ.');
  var need = METHOD_PERM[method];
  if (need && need !== 'PUBLIC' && !acc.perms[need]) {
    throw new Error('Bạn không có quyền thực hiện chức năng này.');
  }

  switch (method) {
    case 'getStatus':    return apiGetStatus(acc);
    case 'changePassword': return changePassword_(acc, payload.oldPassword, payload.newPassword);
    case 'logout':       return { ok: true };
    case 'search':       return searchDocs(payload);
    case 'getDetail':    return getDocDetail(payload.fileId);
    case 'getStats':     return apiGetStats();
    case 'getUploadInfo': return apiGetUploadInfo();
    case 'updateDoc':    return updateDocManual(payload);
    case 'reOcr':        return reOcrDoc(payload.fileId);
    case 'scan':         return scanDrive({ force: !!payload.force });
    case 'ocrQueueRun':  return apiOcrQueueRun();
    case 'setOcrAuto':   return apiSetOcrAuto(payload.enable, payload.hours);
    case 'setOcrLimit':  return apiSetOcrLimit(payload.n);
    case 'setAutoScan':  return apiSetAutoScan(payload.enable, payload.hours);
    case 'saveDocTypes': return saveDocTypes(payload.docTypes || payload);
    case 'resetDocTypes': return apiResetDocTypes();
    case 'saveIssuers':  return saveIssuers(payload.issuers || payload);
    case 'resetIssuers': return apiResetIssuers();
    case 'setVisionKey': return apiSetVisionKey(payload.key);
    case 'testVision':   return apiTestVision();
    case 'initialize':   return apiInitialize(acc);
    case 'listAccounts': return listAccounts_();
    case 'saveAccount':  return saveAccount_(payload);
    case 'deleteAccount': return deleteAccount_(payload.email, acc.email);
    case 'resetPassword': return adminResetPassword_(payload.email, payload.newPassword);
    default: throw new Error('Chức năng không hợp lệ.');
  }
}

/* ============================ API ============================ */

/**
 * Trạng thái hệ thống cho giao diện (khởi tạo lần đầu, folder, DB...).
 */
function apiGetStatus(acc) {
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
    issuers: getIssuers(),
    issuerLevels: getIssuerLevels(),
    totalDocs: countDocs_(),
    visionEnabled: hasVisionKey_(),
    ocrPending: ocrQueueCount(),
    ocrAuto: hasOcrTrigger(),
    ocrDailyLimit: getOcrDailyLimit(),
    ocrUsedToday: ocrUsedToday_(),
    userEmail: (acc ? acc.email : Session.getActiveUser().getEmail()),
    me: (acc ? publicAccount_(acc) : null)
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
function apiInitialize(acc) {
  getOrCreateRootFolder();
  getOrCreateDatabase();
  getAccountsSheet_(); // tạo bảng tài khoản + admin mặc định
  writeLog_('Khởi tạo hệ thống', 0, 'Tạo folder gốc và cơ sở dữ liệu');
  return apiGetStatus(acc);
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
  var byLevel = {};
  var typeNames = {};
  getDocTypes().forEach(function (t) { typeNames[t.code] = t.name; });

  docs.forEach(function (d) {
    var code = d.docTypeCode || 'KHAC';
    byType[code] = (byType[code] || 0) + 1;
    var year = (d.issuedDate || '').substring(0, 4) || 'Không rõ';
    byYear[year] = (byYear[year] || 0) + 1;
    var level = d.issuerLevel || 'Chưa rõ';
    byLevel[level] = (byLevel[level] || 0) + 1;
  });

  var typeStats = Object.keys(byType).map(function (code) {
    return { code: code, name: typeNames[code] || (code === 'KHAC' ? 'Khác' : code), count: byType[code] };
  }).sort(function (a, b) { return b.count - a.count; });

  var yearStats = Object.keys(byYear).map(function (y) {
    return { year: y, count: byYear[y] };
  }).sort(function (a, b) { return a.year < b.year ? 1 : -1; });

  var levelStats = Object.keys(byLevel).map(function (l) {
    return { level: l, count: byLevel[l] };
  }).sort(function (a, b) { return b.count - a.count; });

  return { total: docs.length, byType: typeStats, byYear: yearStats, byLevel: levelStats };
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
 * Chạy hàng đợi OCR một lượt (xử lý dần vài văn bản).
 */
function apiOcrQueueRun() {
  var stats = ocrQueueRun({});
  stats.pending = ocrQueueCount();
  stats.usedToday = ocrUsedToday_();
  stats.dailyLimit = getOcrDailyLimit();
  return stats;
}

/**
 * Bật/tắt lịch tự động OCR hàng đợi.
 */
function apiSetOcrAuto(enable, hours) {
  if (enable) return { ok: true, message: installOcrTrigger(hours || 1), ocrAuto: true };
  var n = removeOcrTrigger();
  return { ok: true, message: 'Đã tắt tự động OCR (' + n + ' trigger).', ocrAuto: false };
}

/**
 * Đặt hạn mức số trang OCR (Vision) mỗi ngày.
 */
function apiSetOcrLimit(n) {
  return { ok: true, dailyLimit: setOcrDailyLimit(n) };
}

/**
 * Lưu danh mục đơn vị ban hành tuỳ biến.
 */
function apiSaveIssuers(issuers) {
  return saveIssuers(issuers);
}

/**
 * Đặt lại danh mục đơn vị ban hành về mặc định.
 */
function apiResetIssuers() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_ISSUERS);
  return getIssuers();
}

/**
 * Cập nhật thông tin văn bản bằng tay (OCR sai/thiếu).
 */
function apiUpdateDoc(payload) {
  return updateDocManual(payload);
}

/**
 * Lưu Vision API key (OCR nâng cao). Truyền rỗng để xoá.
 */
function apiSetVisionKey(key) {
  var enabled = setVisionApiKey(key);
  return { ok: true, visionEnabled: enabled };
}

/**
 * Kiểm tra Vision API key.
 */
function apiTestVision() {
  return testVisionKey();
}

/**
 * Trả link mở folder gốc để người dùng tải văn bản lên.
 */
function apiGetUploadInfo() {
  var folder = getOrCreateRootFolder();
  return { folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName() };
}


