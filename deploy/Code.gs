/*************************************************************************
 * QLVB-EPU - FILE MÃ NGUỒN GỘP
 * Gồm: Config Storage Classifier Issuer Keywords Analyzer Vision Ocr OcrQueue Scanner Search Duplicate Trash Audit Export Upload Auth Code
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
var PROP_DUP_COUNT = 'DUP_DOCS_COUNT';        // Số văn bản nghi trùng lặp (cập nhật sau mỗi lần quét)
var PROP_DOC_TYPES = 'DOC_TYPES_JSON';        // Danh sách loại VB (JSON) - có thể tuỳ biến

// Tên mặc định
var DEFAULT_ROOT_FOLDER_NAME = 'QLVB-EPU';
var DEFAULT_DB_SPREADSHEET_NAME = 'QLVB-EPU - Cơ sở dữ liệu văn bản';
var DB_SHEET_DOCS = 'VanBan';    // Sheet chứa danh mục văn bản
var DB_SHEET_LOG = 'NhatKy';     // Sheet nhật ký quét

/**
 * Trích Folder ID từ URL Google Drive hoặc chuỗi ID thô.
 * Hỗ trợ: .../folders/<id>, ...?id=<id>, .../open?id=<id>, hoặc ID thô.
 * Trả về ID (chuỗi) nếu nhận ra, hoặc null nếu không hợp lệ.
 * Hàm thuần (không phụ thuộc dịch vụ) để dễ kiểm thử.
 */
function parseFolderId_(input) {
  var s = String(input || '').trim();
  if (!s) return null;
  // URL dạng /folders/<id>
  var m = s.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // URL dạng ?id=<id> hoặc &id=<id> (open?id=..., uc?id=...)
  m = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // ID thô (không phải URL): chuỗi ký tự hợp lệ của Drive.
  if (s.indexOf('/') === -1 && /^[a-zA-Z0-9_-]{10,}$/.test(s)) return s;
  return null;
}

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

/* ===================== TRẠNG THÁI / ĐỘ MẬT / ĐỘ KHẨN ===================== */
function getStatusOptions() { return ['Mới', 'Đang xử lý', 'Hoàn thành', 'Lưu trữ']; }
function getSecurityOptions() { return ['Thường', 'Mật', 'Tối mật']; }
function getUrgencyOptions() { return ['Thường', 'Khẩn', 'Thượng khẩn']; }

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

/* ===================== PHÂN TÍCH NỘI DUNG (Analyzer) ===================== */
/*
 * Tham số cho động cơ phân tích nội dung. Đặt ở Config để dễ tuỳ chỉnh,
 * không hardcode rải rác trong thuật toán.
 */
var ANALYZER_MAX_KEYPHRASES = 5;   // Số key phrase hiển thị/lưu ở cột "Từ khóa" (3–5).
var ANALYZER_MAX_CONCEPTS = 12;    // Số khái niệm lưu trong hồ sơ phân tích (phục vụ độ liên quan).
var ANALYZER_MAX_PHRASE_WORDS = 4; // Độ dài tối đa của một cụm ứng viên (âm tiết); ~2 từ ghép TV.
var ANALYZER_MAX_ENTITIES = 8;     // Số đối tượng/đơn vị lưu tối đa.
var ANALYZER_MAX_LEGALREFS = 10;   // Số căn cứ pháp lý/tiêu chuẩn lưu tối đa.
var ANALYSIS_TEXT_LIMIT = 12000;   // Số ký tự nội dung dùng để phân tích (đủ đại diện, tránh chậm).

var PROP_FIELDS = 'FIELDS_JSON'; // Danh mục Lĩnh vực tuỳ biến (JSON)

// Các lựa chọn HIỆU LỰC của văn bản.
function getValidityOptions() { return ['Còn hiệu lực', 'Hết hiệu lực', 'Chưa xác định']; }

// Các nhãn TRẠNG THÁI XỬ LÝ (suy diễn) dùng cho bộ lọc tìm kiếm.
function getProcessingStatuses() {
  return ['Chưa OCR', 'Đang OCR', 'Lỗi OCR', 'File quá lớn', 'Chưa kiểm tra', 'Đã kiểm tra'];
}

/**
 * Danh mục LĨNH VỰC hiện dùng (ưu tiên cấu hình tuỳ biến trong Cài đặt, else mặc định).
 */
function getFieldDictionary() {
  var raw = PropertiesService.getScriptProperties().getProperty(PROP_FIELDS);
  if (raw) {
    try {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.length) return parsed;
    } catch (e) { /* fallback về mặc định */ }
  }
  return getDefaultFields();
}

/** Danh sách TÊN lĩnh vực (cho dropdown / bộ lọc). */
function getFieldNames() {
  return getFieldDictionary().map(function (f) { return f.field; });
}

/** Lưu danh mục Lĩnh vực tuỳ biến. */
function saveFields(fields) {
  PropertiesService.getScriptProperties().setProperty(PROP_FIELDS, JSON.stringify(fields));
  return getFieldDictionary();
}

/**
 * Từ điển LĨNH VỰC mặc định (không dấu, thường). Dùng để suy ra "lĩnh vực" của văn bản
 * theo số từ khoá khớp trong tiêu đề + nội dung + key phrases.
 */
function getDefaultFields() {
  return [
    { field: 'Đào tạo', keywords: ['dao tao', 'tin chi', 'hoc phan', 'tuyen sinh', 'chuong trinh dao tao', 'tot nghiep', 'giang day', 'hoc vu', 'thoi khoa bieu', 'do an', 'khoa luan'] },
    { field: 'Tổ chức - Cán bộ', keywords: ['to chuc can bo', 'nhan su', 'bo nhiem', 'vien chuc', 'tuyen dung', 'hop dong lam viec', 'dieu dong', 'thi dua khen thuong', 'ky luat'] },
    { field: 'Tài chính - Kế toán', keywords: ['tai chinh', 'ke toan', 'ngan sach', 'thu chi', 'hoc phi', 'mua sam', 'dau thau', 'quyet toan', 'kinh phi', 'dinh muc', 'thanh toan'] },
    { field: 'Khoa học - Công nghệ', keywords: ['khoa hoc', 'cong nghe', 'nghien cuu', 'de tai', 'sang kien', 'hoi thao', 'hoi nghi khoa hoc', 'cong bo', 'so huu tri tue'] },
    { field: 'Công tác sinh viên', keywords: ['cong tac sinh vien', 'hoc bong', 'ren luyen', 'ky luat sinh vien', 'noi tru', 'ngoai tru', 'bao hiem y te', 'chinh sach sinh vien'] },
    { field: 'Hành chính - Văn thư', keywords: ['hanh chinh', 'van thu', 'luu tru', 'con dau', 'cong van den', 'cong van di', 'lich cong tac'] },
    { field: 'Cơ sở vật chất', keywords: ['co so vat chat', 'thiet bi', 'phong hoc', 'ky tuc xa', 'sua chua', 'xay dung', 'quan ly tai san'] },
    { field: 'Hợp tác quốc tế', keywords: ['hop tac quoc te', 'doi ngoai', 'nuoc ngoai', 'lien ket quoc te', 'trao doi sinh vien'] },
    { field: 'Đảm bảo chất lượng', keywords: ['dam bao chat luong', 'kiem dinh', 'danh gia chat luong', 'khao thi', 'chuan dau ra'] }
  ];
}

/**
 * Bộ trọng số cho tính TÀI LIỆU LIÊN QUAN (đa yếu tố). Tách khỏi thuật toán để dễ tinh chỉnh.
 * threshold: điểm tối thiểu để coi là "liên quan".
 */
function getRelatedWeights() {
  return {
    cosine: 100,   // hệ số cho độ tương đồng nội dung (cosine 0..1)
    legalRef: 14,  // mỗi căn cứ pháp lý/tiêu chuẩn dùng chung
    legalRefCap: 3,// tối đa số căn cứ dùng chung được tính điểm
    field: 8,      // cùng lĩnh vực
    titleTerm: 3,  // mỗi từ khoá tiêu đề trùng nhau
    titleTermCap: 4,
    sameType: 5,   // cùng loại văn bản
    sameIssuer: 6, // cùng đơn vị ban hành
    sameLevel: 2,  // cùng cấp ban hành (khi khác đơn vị)
    sameYear: 2,   // cùng năm ban hành
    threshold: 4
  };
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

/* ===================== Keywords.gs ===================== */
/**
 * Keywords.gs
 * Tầng TỪ VỰNG: tách token, lọc từ dừng, và trích KEY PHRASES chất lượng bằng RAKE
 * (Rapid Automatic Keyword Extraction) — chọn cụm theo điểm degree/freq, ưu tiên cụm
 * danh từ/thuật ngữ, khử trùng lặp/gần giống, KHÔNG thuần theo tần suất.
 *
 * Cột "Từ khóa" lưu 3–5 key phrase dạng: "khoa hoc cong nghe|9, quy che dao tao|7, ..."
 * (cụm hiển thị | trọng số). Phân tích nội dung & tài liệu liên quan nằm ở Analyzer.gs.
 */

var VI_STOPWORDS = {
  'cua': 1, 'va': 1, 'cac': 1, 'cho': 1, 'duoc': 1, 'trong': 1, 'la': 1, 'co': 1, 'mot': 1,
  'nhung': 1, 'de': 1, 'voi': 1, 'theo': 1, 'khi': 1, 'nay': 1, 'da': 1, 'tai': 1, 've': 1,
  'tu': 1, 'den': 1, 'cung': 1, 'nhu': 1, 'sau': 1, 'truoc': 1, 'do': 1, 'boi': 1, 'hoac': 1,
  'neu': 1, 'thi': 1, 'ma': 1, 'ra': 1, 'vao': 1, 'len': 1, 'xuong': 1, 'hon': 1, 'rat': 1,
  'se': 1, 'dang': 1, 'bi': 1, 'phai': 1, 'con': 1, 'nen': 1, 'tren': 1, 'duoi': 1, 'giua': 1,
  'ngoai': 1, 'cai': 1, 'nao': 1, 'gi': 1, 'ai': 1, 'dau': 1, 'sao': 1, 'the': 1, 'vi': 1,
  'nham': 1, 'qua': 1, 'lai': 1, 'nua': 1, 'chi': 1, 'chua': 1, 'hay': 1, 'tuy': 1, 'tuc': 1,
  'so': 1, 'ngay': 1, 'thang': 1, 'nam': 1, 'viec': 1, 'kem': 1, 'gom': 1, 'moi': 1, 'toan': 1,
  'thuc hien': 0
};
function isStopword_(nw) { return VI_STOPWORDS[nw] === 1; }

/**
 * Tách văn bản thành danh sách token {d: hiển thị (thường), n: chuẩn hoá không dấu}.
 */
function tokenizeVi_(text) {
  var raw = String(text || '').substring(0, ANALYSIS_TEXT_LIMIT).toLowerCase();
  var words = raw.replace(/[^0-9a-zà-ỹ\s]/gi, ' ').split(/\s+/).filter(Boolean);
  return words.map(function (w) { return { d: w, n: normalizeVi_(w) }; });
}

/**
 * Trích KEY PHRASES bằng RAKE.
 *  - Cắt văn bản thành cụm ứng viên tại các từ dừng / số / token quá ngắn.
 *  - Điểm mỗi từ = degree/freq (degree = tổng bậc đồng xuất hiện trong cụm).
 *  - Điểm cụm = tổng điểm từ; ưu tiên cụm nhiều từ (danh từ ghép) và cụm lặp lại.
 *  - Khử trùng lặp/gần giống (bao hàm token hoặc trùng >= 60%).
 * Trả mảng {t: hiển thị, n: chuẩn hoá, f: trọng số nguyên} đã xếp theo điểm giảm dần.
 */
function extractKeyphrases_(text, maxN) {
  maxN = maxN || ANALYZER_MAX_KEYPHRASES;
  var raw = String(text || '').substring(0, ANALYSIS_TEXT_LIMIT).toLowerCase();
  if (!raw.trim()) return [];

  var maxLen = ANALYZER_MAX_PHRASE_WORDS;

  // (1) Cắt thành ĐOẠN ứng viên: trước hết theo dấu câu (ranh giới câu/cụm), rồi theo
  //     từ dừng / số / token quá ngắn — KHÔNG để cụm bắc qua dấu câu hay từ dừng.
  var segs = [], cur = [];
  function isBoundary(t) { return isStopword_(t.n) || t.n.length < 2 || /^\d+$/.test(t.n); }
  function flushSeg() { if (cur.length) { segs.push(cur); cur = []; } }
  var chunks = raw.split(/[^0-9a-zà-ỹ\s]+/); // tách tại dấu câu / ký tự đặc biệt
  for (var ci = 0; ci < chunks.length; ci++) {
    var words = chunks[ci].split(/\s+/).filter(Boolean);
    for (var wi = 0; wi < words.length; wi++) {
      var t = { d: words[wi], n: normalizeVi_(words[wi]) };
      if (isBoundary(t)) flushSeg();
      else cur.push(t);
    }
    flushSeg(); // hết một chunk -> đóng đoạn (không bắc qua dấu câu)
  }
  if (!segs.length) return [];

  // (2) RAKE: freq & degree cho từng từ dựa trên đồng xuất hiện trong đoạn.
  var freq = {}, degree = {};
  for (var p = 0; p < segs.length; p++) {
    var deg = segs[p].length;
    for (var w = 0; w < segs[p].length; w++) {
      var n = segs[p][w].n;
      freq[n] = (freq[n] || 0) + 1;
      degree[n] = (degree[n] || 0) + deg;
    }
  }
  function wscore(n) { return degree[n] / freq[n]; }

  // (3) Sinh cụm ứng viên (n-gram dài 1..maxLen trong mỗi đoạn), gộp trùng, tính điểm.
  var byKey = {}, cand = [];
  for (var s = 0; s < segs.length; s++) {
    var seg = segs[s];
    for (var L = 1; L <= maxLen; L++) {
      for (var st = 0; st + L <= seg.length; st++) {
        var g = seg.slice(st, st + L);
        var nkey = g.map(function (x) { return x.n; }).join(' ');
        if (byKey[nkey]) { byKey[nkey].occ++; continue; }
        var disp = g.map(function (x) { return x.d; }).join(' ');
        var base = 0;
        for (var r = 0; r < g.length; r++) base += wscore(g[r].n);
        byKey[nkey] = { t: disp, n: nkey, len: L, base: base, occ: 1 };
        cand.push(byKey[nkey]);
      }
    }
  }
  // Điểm cuối: điểm RAKE * thưởng cụm nhiều từ * hệ số lần xuất hiện (không thuần tần suất).
  cand.forEach(function (c) {
    var mult = (c.len > 1 ? 1.4 : 1) * (1 + Math.log(c.occ));
    c.score = c.base * mult;
  });
  cand.sort(function (a, b) { return b.score - a.score; });

  // Khử trùng lặp/gần giống, giữ tối đa maxN.
  var kept = [];
  for (var k = 0; k < cand.length && kept.length < maxN; k++) {
    var c2 = cand[k];
    var dup = false;
    for (var j = 0; j < kept.length; j++) {
      if (phrasesNearDuplicate_(c2.n, kept[j].n)) { dup = true; break; }
    }
    if (!dup) kept.push(c2);
  }
  return kept.map(function (c) { return { t: c.t, n: c.n, f: Math.max(1, Math.round(c.score)) }; });
}

/**
 * Hai cụm coi là "gần trùng" nếu một cụm chứa trọn cụm kia (theo token), hoặc trùng >= 60% token.
 */
function phrasesNearDuplicate_(a, b) {
  if (a === b) return true;
  var ta = a.split(' '), tb = b.split(' ');
  var setB = {}; tb.forEach(function (w) { setB[w] = 1; });
  var inter = 0; ta.forEach(function (w) { if (setB[w]) inter++; });
  if (inter === ta.length || inter === tb.length) return true; // bao hàm
  var uni = ta.length + tb.length - inter;
  return uni > 0 && (inter / uni) >= 0.6;
}

/** Chuỗi lưu CSDL từ hồ sơ cụm. */
function profileToString_(profile) {
  return profile.map(function (x) { return x.t + '|' + x.f; }).join(', ');
}
/** Đọc chuỗi "cụm|trọng số, ..." thành mảng {t, n, f}. */
function parseProfile_(str) {
  var out = [];
  String(str || '').split(',').forEach(function (item) {
    item = item.trim();
    if (!item) return;
    var pos = item.lastIndexOf('|');
    var t = pos === -1 ? item : item.substring(0, pos);
    var f = pos === -1 ? 1 : (parseInt(item.substring(pos + 1), 10) || 1);
    var n = normalizeVi_(t).trim();
    if (n) out.push({ t: t.trim(), n: n, f: f });
  });
  return out;
}

/**
 * Chuỗi 3–5 key phrase để lưu cột "Từ khóa" (từ tiêu đề + nội dung).
 * Giữ tên hàm cũ để các nơi đang gọi không phải đổi.
 */
function computeKeywords_(text) {
  return profileToString_(extractKeyphrases_(text, ANALYZER_MAX_KEYPHRASES));
}

/**
 * Chuẩn hoá danh sách key phrase do người dùng nhập tay (mảng hoặc chuỗi ngăn bởi dấu phẩy)
 * thành chuỗi "cụm|trọng số" để lưu cột "Từ khóa". Khử trùng, giữ thứ tự, gán trọng số giảm dần.
 */
function sanitizeKeywords_(input) {
  var arr = Array.isArray(input) ? input : String(input || '').split(',');
  var seen = {}, out = [];
  arr.forEach(function (s) {
    s = String(s).trim();
    var pos = s.lastIndexOf('|');
    if (pos !== -1 && /^\d+$/.test(s.substring(pos + 1).trim())) s = s.substring(0, pos).trim(); // bỏ trọng số nếu có
    if (!s) return;
    var k = normalizeVi_(s);
    if (k && !seen[k]) { seen[k] = 1; out.push(s); }
  });
  return out.map(function (t, i) { return t + '|' + Math.max(1, out.length - i); }).join(', ');
}

/* ===================== Analyzer.gs ===================== */
/**
 * Analyzer.gs
 * Động cơ PHÂN TÍCH NỘI DUNG & KHÁM PHÁ tài liệu (không gọi API ngoài).
 *
 * Với mỗi văn bản, phân tích nội dung OCR + metadata để rút:
 *   - topic     : chủ đề chính (key phrase tiêu biểu nhất)
 *   - field     : lĩnh vực (theo từ điển trong Config)
 *   - concepts  : các khái niệm quan trọng (key phrases mở rộng, phục vụ độ liên quan)
 *   - entities  : đối tượng/đơn vị được nhắc tới
 *   - legalRefs : căn cứ pháp lý / tiêu chuẩn (Nghị định, Thông tư, QĐ số, Luật, TCVN/QCVN/ISO...)
 *
 * Hồ sơ phân tích được LƯU (cột "Phân tích" dạng JSON) và chỉ tính lại khi OCR xong
 * hoặc khi văn bản được cập nhật — KHÔNG tính trong lúc tìm kiếm.
 *
 * Tài liệu liên quan được xếp hạng ĐA YẾU TỐ: nội dung (TF-IDF/cosine trên khái niệm) +
 * căn cứ pháp lý dùng chung + lĩnh vực + tiêu đề + loại/đơn vị/cấp/năm.
 */

/* ===================== TRÍCH TÍN HIỆU PHÂN TÍCH ===================== */

/**
 * Nhận diện căn cứ pháp lý / tiêu chuẩn trong văn bản. Trả mảng chuỗi (đã khử trùng theo dạng
 * chuẩn hoá), giữ bản hiển thị gần với văn bản gốc.
 */
function detectLegalRefs_(text) {
  var s = String(text || '');
  var found = {}, order = [];
  function add(x) {
    var disp = x.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
    var key = normalizeVi_(disp);
    if (key && !found.hasOwnProperty(key)) { found[key] = disp; order.push(key); }
  }
  var patterns = [
    /\b(TCVN|QCVN|ISO|IEC)\s*[:\-]?\s*\d[\d.\-:\/]*/gi,               // tiêu chuẩn
    /\b\d{1,4}\/\d{2,4}\/[A-Za-zĐđ][A-Za-zĐđ0-9\-]*/g,                 // 08/2021/TT-BGDĐT
    /(nghị định|thông tư|nghị quyết|chỉ thị|quyết định|công văn|kế hoạch|thông báo|luật)\s+(số\s*)?\d{1,4}(\/\d{2,4})?([\/\-][A-Za-zĐđ0-9\-]+)?/gi
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(s)) !== null) {
      add(m[0]);
      if (m.index === patterns[p].lastIndex) patterns[p].lastIndex++; // tránh vòng lặp vô hạn với match rỗng
    }
  }
  // Bỏ ref bị chứa trọn trong ref khác dài hơn (giữ dạng đầy đủ "Thông tư 08/2021/..."),
  // tránh trùng lặp kiểu số trần vs có tên loại.
  var keys = order.filter(function (k) {
    for (var i = 0; i < order.length; i++) {
      if (order[i] !== k && order[i].length > k.length && order[i].indexOf(k) !== -1) return false;
    }
    return true;
  });
  return keys.slice(0, ANALYZER_MAX_LEGALREFS).map(function (k) { return found[k]; });
}

/**
 * Nhận diện đối tượng/đơn vị được nhắc tới (dựa danh mục đơn vị ban hành trong Config + đơn vị của VB).
 * normText: nội dung đã chuẩn hoá (không dấu, thường).
 */
function detectEntities_(doc, normText) {
  var out = [], seen = {};
  function push(name) {
    if (!name) return;
    var k = normalizeVi_(name);
    if (k && !seen[k]) { seen[k] = 1; out.push(name); }
  }
  if (doc.issuer) push(doc.issuer);
  var issuers = getIssuers();
  for (var i = 0; i < issuers.length && out.length < ANALYZER_MAX_ENTITIES; i++) {
    var kws = issuers[i].keywords || [];
    for (var j = 0; j < kws.length; j++) {
      if (kws[j] && normText.indexOf(kws[j]) !== -1) { push(issuers[i].name); break; }
    }
  }
  return out.slice(0, ANALYZER_MAX_ENTITIES);
}

/**
 * Suy ra LĨNH VỰC theo từ điển: cụm 2 từ tính điểm cao hơn từ đơn. Trả '' nếu không rõ.
 */
function detectField_(normText) {
  var dict = getFieldDictionary();
  var best = '', bestScore = 0;
  for (var i = 0; i < dict.length; i++) {
    var sc = 0, kws = dict[i].keywords;
    for (var j = 0; j < kws.length; j++) {
      if (normText.indexOf(kws[j]) !== -1) sc += (kws[j].indexOf(' ') !== -1 ? 2 : 1);
    }
    if (sc > bestScore) { bestScore = sc; best = dict[i].field; }
  }
  return best;
}

/**
 * Dựng hồ sơ phân tích cho 1 văn bản. Trả { obj, keyphrases }.
 *   obj        : đối tượng phân tích để lưu (topic/field/concepts/entities/legalRefs)
 *   keyphrases : 3–5 cụm tốt nhất (để lưu cột "Từ khóa")
 */
function buildAnalysis_(doc) {
  var text = (doc.title || '') + ' \n ' + (doc.content || '');
  var normText = normalizeVi_(text);
  var concepts = extractKeyphrases_(text, ANALYZER_MAX_CONCEPTS);
  var keyphrases = concepts.slice(0, ANALYZER_MAX_KEYPHRASES);
  var obj = {
    topic: keyphrases.length ? keyphrases[0].t : String(doc.title || '').substring(0, 80),
    field: detectField_(normText),
    concepts: concepts.map(function (c) { return { t: c.t, n: c.n, w: c.f }; }),
    entities: detectEntities_(doc, normText),
    legalRefs: detectLegalRefs_(text)
  };
  return { obj: obj, keyphrases: keyphrases };
}

/** JSON hoá hồ sơ phân tích để lưu CSDL (an toàn, không ném lỗi ra luồng chính). */
function analysisToString_(o) {
  try { return JSON.stringify(o || {}); } catch (e) { return ''; }
}
/** Đọc hồ sơ phân tích từ chuỗi JSON; luôn trả cấu trúc đầy đủ. */
function parseAnalysis_(str) {
  var empty = { topic: '', field: '', concepts: [], entities: [], legalRefs: [], kwManual: false, fieldManual: false };
  if (!str) return empty;
  try {
    var o = JSON.parse(str);
    return {
      topic: o.topic || '',
      field: o.field || '',
      concepts: Array.isArray(o.concepts) ? o.concepts : [],
      entities: Array.isArray(o.entities) ? o.entities : [],
      legalRefs: Array.isArray(o.legalRefs) ? o.legalRefs : [],
      kwManual: !!o.kwManual,
      fieldManual: !!o.fieldManual
    };
  } catch (e) { return empty; }
}

/**
 * Tính & GẮN hồ sơ phân tích vào văn bản: đặt doc.keywords (3–5) và doc.analysis (JSON).
 * Đây là điểm vào duy nhất được các hook (OCR xong / cập nhật / quét) gọi -> tránh trùng code.
 */
function analyzeAndAttach_(doc) {
  var prev = parseAnalysis_(doc.analysis);
  // Cờ sửa tay: ưu tiên cờ đặt tường minh trên doc, nếu không thì lấy từ hồ sơ đã lưu.
  var kwManual = (doc.kwManual != null) ? !!doc.kwManual : !!prev.kwManual;
  var fieldManual = (doc.fieldManual != null) ? !!doc.fieldManual : !!prev.fieldManual;

  var res = buildAnalysis_(doc);
  if (!kwManual) doc.keywords = profileToString_(res.keyphrases); // else giữ key phrases đặt tay
  if (!fieldManual) doc.field = res.obj.field;                    // else giữ lĩnh vực đặt tay

  res.obj.kwManual = kwManual;
  res.obj.fieldManual = fieldManual;
  doc.analysis = analysisToString_(res.obj);
  return doc;
}

/**
 * Giải các quan hệ văn bản (fileId) thành thông tin gọn để hiển thị (tiêu đề, số, ngày, hiệu lực).
 */
function resolveRelations_(relStr) {
  var rel = parseRelations_(relStr);
  function lite(id) {
    var d = getDocDetailFast_(id);
    if (!d) return { fileId: String(id), title: '(không còn trong CSDL)', missing: true };
    return {
      fileId: d.fileId, title: d.title || d.fileName, docType: d.docType,
      docNumber: d.docNumber, issuedDate: d.issuedDate, validity: d.validity
    };
  }
  return {
    replaces: rel.replaces.map(lite),
    replacedBy: rel.replacedBy.map(lite),
    related: rel.related.map(lite)
  };
}

/**
 * Văn bản đã phân tích -> chuỗi "để tìm kiếm theo nội dung": key phrases + lĩnh vực +
 * đối tượng + căn cứ pháp lý (đã chuẩn hoá). Giúp Search khớp theo chủ đề, không chỉ substring.
 */
function analysisSearchText_(doc) {
  var a = parseAnalysis_(doc.analysis);
  var parts = [doc.keywords || '', a.field || ''];
  parts.push(a.concepts.map(function (c) { return c.t; }).join(' '));
  parts.push(a.entities.join(' '));
  parts.push(a.legalRefs.join(' '));
  return normalizeVi_(parts.join(' \n '));
}

/* ===================== TÀI LIỆU LIÊN QUAN (ĐA YẾU TỐ) ===================== */

/**
 * Đọc "nhẹ" các cột cần cho tính liên quan (gồm cột Phân tích), KHÔNG đọc nội dung nặng.
 */
function readRelatedDocs_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = lastRow - 1;
  var a = sheet.getRange(2, 1, n, COLS.TITLE + 1).getValues();
  var b = sheet.getRange(2, COLS.ISSUER + 1, n, COLS.ANALYSIS - COLS.ISSUER + 1).getValues();
  var kOff = COLS.KEYWORDS - COLS.ISSUER;
  var aOff = COLS.ANALYSIS - COLS.ISSUER;
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      fileId: cell_(a[i][COLS.FILE_ID]),
      fileName: cell_(a[i][COLS.FILE_NAME]),
      docType: cell_(a[i][COLS.DOC_TYPE]),
      docTypeCode: cell_(a[i][COLS.DOC_TYPE_CODE]),
      docNumber: cell_(a[i][COLS.DOC_NUMBER]),
      issuedDate: dateCell_(a[i][COLS.ISSUED_DATE]),
      title: cell_(a[i][COLS.TITLE]),
      issuer: cell_(b[i][0]),
      issuerLevel: cell_(b[i][1]),
      keywords: cell_(b[i][kOff]),
      analysis: cell_(b[i][aOff])
    });
  }
  return out;
}

/** Tập token tiêu đề (chuẩn hoá, bỏ từ dừng, >=3 ký tự). */
function titleTermSet_(title) {
  var set = {};
  tokenizeVi_(title).forEach(function (t) {
    if (t.n.length >= 3 && !isStopword_(t.n) && !/^\d+$/.test(t.n)) set[t.n] = 1;
  });
  return set;
}

/**
 * Tìm 5–10 tài liệu liên quan nhất tới fileId, kết hợp nhiều yếu tố.
 */
function getRelatedDocs_(fileId, limit) {
  limit = Math.min(Math.max(limit || 8, 5), 10);
  var docs = readRelatedDocs_();
  var N = docs.length;
  if (N < 2) return [];

  var W = getRelatedWeights();

  // Chuẩn bị tín hiệu cho từng văn bản.
  var sig = docs.map(function (d) {
    var a = parseAnalysis_(d.analysis);
    var terms = a.concepts.length
      ? a.concepts.map(function (c) { return { n: c.n, w: c.w || 1 }; })
      : parseProfile_(d.keywords).map(function (x) { return { n: x.n, w: x.f }; });
    var legalSet = {};
    a.legalRefs.forEach(function (x) { var k = normalizeVi_(x); if (k) legalSet[k] = 1; });
    return { terms: terms, field: a.field, legal: legalSet, titleTerms: titleTermSet_(d.title) };
  });

  // Document frequency + IDF trên khái niệm.
  var df = {};
  for (var i = 0; i < N; i++) {
    var seen = {};
    for (var j = 0; j < sig[i].terms.length; j++) {
      var t = sig[i].terms[j].n;
      if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; }
    }
  }
  function idf(t) { return Math.log(1 + N / ((df[t] || 0) + 0.5)); }
  function vec(terms) {
    var v = {}, norm2 = 0;
    for (var k = 0; k < terms.length; k++) {
      var w = (1 + Math.log(terms[k].w > 0 ? terms[k].w : 1)) * idf(terms[k].n);
      v[terms[k].n] = w; norm2 += w * w;
    }
    return { v: v, len: Math.sqrt(norm2) || 1 };
  }

  var ti = -1;
  for (var x = 0; x < N; x++) if (docs[x].fileId === fileId) { ti = x; break; }
  if (ti === -1) return [];
  var target = docs[ti], tsig = sig[ti];
  var tv = vec(tsig.terms);
  var tYear = (target.issuedDate || '').substring(0, 4);
  var tKeys = Object.keys(tv.v);

  var scored = [];
  for (var m = 0; m < N; m++) {
    if (m === ti) continue;
    var d = docs[m], s = sig[m];
    var ov = vec(s.terms);

    // (1) Nội dung: cosine trên khái niệm.
    var dot = 0, shared = 0;
    for (var y = 0; y < tKeys.length; y++) {
      var tk = tKeys[y];
      if (ov.v[tk]) { dot += tv.v[tk] * ov.v[tk]; shared++; }
    }
    var cosine = dot / (tv.len * ov.len);
    var score = cosine * W.cosine;

    // (2) Căn cứ pháp lý dùng chung (tín hiệu mạnh).
    var sharedRefs = 0;
    for (var lk in tsig.legal) { if (s.legal[lk]) sharedRefs++; }
    if (sharedRefs) score += Math.min(sharedRefs, W.legalRefCap) * W.legalRef;

    // (3) Cùng lĩnh vực.
    if (s.field && s.field === tsig.field) score += W.field;

    // (4) Trùng từ khoá tiêu đề.
    var tt = 0;
    for (var tw in tsig.titleTerms) { if (s.titleTerms[tw]) tt++; }
    if (tt) score += Math.min(tt, W.titleTermCap) * W.titleTerm;

    // (5) Danh mục / metadata.
    if (d.docTypeCode && d.docTypeCode === target.docTypeCode) score += W.sameType;
    if (d.issuer && d.issuer === target.issuer) score += W.sameIssuer;
    else if (d.issuerLevel && d.issuerLevel === target.issuerLevel) score += W.sameLevel;
    if (tYear && (d.issuedDate || '').substring(0, 4) === tYear) score += W.sameYear;

    if (score >= W.threshold) {
      scored.push({
        fileId: d.fileId, title: d.title, fileName: d.fileName, docType: d.docType,
        docNumber: d.docNumber, issuedDate: d.issuedDate, issuer: d.issuer,
        field: s.field, shared: shared, sharedRefs: sharedRefs,
        similarity: Math.round(cosine * 100), score: Math.round(score)
      });
    }
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
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
  // Luôn cập nhật key phrases + hồ sơ phân tích theo nội dung mới (kể cả bản đã sửa tay).
  analyzeAndAttach_(d);
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
    analysis: '',
    field: '',
    validity: 'Chưa xác định',
    relations: ''
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

  // Phân tích từ khoá: nếu bọc trong "..." -> yêu cầu khớp nguyên cụm (exact phrase).
  var rawKw = (query.keyword || '').trim();
  var exactPhrase = /^".*"$/.test(rawKw);
  var phrase = normalizeVi_(rawKw.replace(/^"|"$/g, '')).replace(/\s+/g, ' ').trim();
  var terms = phrase ? phrase.split(' ') : [];
  var isMultiWord = terms.length > 1;

  var issuerKw = normalizeVi_(query.issuer || '').trim();
  var numberKw = normalizeVi_(query.docNumber || '').trim();

  var filtered = docs.filter(function (d) {
    if (query.typeCode && d.docTypeCode !== query.typeCode) return false;
    if (query.issuerLevel && d.issuerLevel !== query.issuerLevel) return false;
    if (issuerKw && normalizeVi_(d.issuer || '').indexOf(issuerKw) === -1) return false;
    if (numberKw && normalizeVi_(d.docNumber || '').indexOf(numberKw) === -1) return false;
    if (query.field && d.field !== query.field) return false;
    if (query.validity && (d.validity || 'Chưa xác định') !== query.validity) return false;
    if (query.procStatus && d.procStatus !== query.procStatus) return false;
    if (query.fromDate && (!d.issuedDate || d.issuedDate < query.fromDate)) return false;
    if (query.toDate && (!d.issuedDate || d.issuedDate > query.toDate)) return false;
    if (terms.length) {
      // Haystack gồm cả tín hiệu phân tích (key phrases/lĩnh vực/đối tượng/căn cứ pháp lý)
      // -> tìm theo NỘI DUNG/chủ đề, không chỉ dính chữ trong văn bản.
      var hay = normalizeVi_([
        d.fileName, d.docNumber, d.title, d.docType, d.content, d.folderPath,
        d.issuer, d.issuerLevel
      ].join(' \n ')) + ' \n ' + analysisSearchText_(d);
      if (exactPhrase) {
        if (hay.indexOf(phrase) === -1) return false; // bắt buộc khớp nguyên cụm
      } else {
        for (var i = 0; i < terms.length; i++) {
          if (hay.indexOf(terms[i]) === -1) return false; // AND các từ khoá
        }
      }
    }
    return true;
  });

  // Chấm điểm liên quan (ưu tiên khớp nguyên cụm, khớp ở tiêu đề/số hiệu).
  if (terms.length) {
    filtered.forEach(function (d) { d.__score = scoreDoc_(d, phrase, terms, isMultiWord); });
  }

  // Sắp xếp: có từ khoá -> mặc định theo độ liên quan; không thì theo trường được chọn.
  var sortBy = query.sortBy || (terms.length ? 'relevance' : 'issuedDate');
  if (sortBy === 'relevance' && !terms.length) sortBy = 'issuedDate';
  var dir = query.sortDir === 'asc' ? 1 : -1;
  if (sortBy === 'relevance') {
    filtered.sort(function (a, b) {
      if (b.__score !== a.__score) return b.__score - a.__score;       // điểm cao lên trước
      return (a.issuedDate < b.issuedDate ? 1 : (a.issuedDate > b.issuedDate ? -1 : 0)); // rồi mới nhất
    });
  } else {
    filtered.sort(function (a, b) {
      var va = (a[sortBy] || '').toString();
      var vb = (b[sortBy] || '').toString();
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }

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
      field: d.field,
      validity: d.validity,
      procStatus: d.procStatus,
      folderPath: d.folderPath,
      mimeType: d.mimeType,
      fileUrl: d.fileUrl,
      ocrStatus: d.ocrStatus,
      snippet: makeSnippet_(d.content, terms, phrase)
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
 * Đếm số lần xuất hiện (giới hạn) của t trong hay.
 */
function countOcc_(hay, t) {
  if (!t) return 0;
  var i = 0, n = 0;
  while ((i = hay.indexOf(t, i)) !== -1) { n++; i += t.length; if (n > 30) break; }
  return n;
}

/**
 * Chấm điểm liên quan: ưu tiên khớp NGUYÊN CỤM, và khớp ở tiêu đề/số hiệu hơn nội dung.
 */
function scoreDoc_(d, phrase, terms, isMultiWord) {
  var title = normalizeVi_(d.title || '');
  var num = normalizeVi_(d.docNumber || '');
  var issuer = normalizeVi_(d.issuer || '');
  var fname = normalizeVi_(d.fileName || '');
  var content = normalizeVi_(d.content || '');
  var score = 0;

  if (isMultiWord && phrase) {
    // Khớp nguyên cụm từ -> điểm cao (ưu tiên hàng đầu).
    if (title.indexOf(phrase) !== -1) score += 120;
    if (num.indexOf(phrase) !== -1) score += 100;
    if (content.indexOf(phrase) !== -1) score += 60;
    if (fname.indexOf(phrase) !== -1) score += 40;
    if (issuer.indexOf(phrase) !== -1) score += 40;
  }
  // Tín hiệu PHÂN TÍCH NỘI DUNG: ưu tiên tài liệu mà truy vấn khớp key phrase/chủ đề/
  // lĩnh vực/căn cứ pháp lý (chủ đề đúng), thay vì chỉ dính chữ tình cờ trong nội dung.
  var a = parseAnalysis_(d.analysis);
  var kp = normalizeVi_(d.keywords || '');                       // 3–5 key phrases
  var topic = normalizeVi_(a.topic || '');
  var field = normalizeVi_(a.field || '');
  var concepts = a.concepts.map(function (c) { return c.n; }).join(' \n ');
  var legal = a.legalRefs.map(function (x) { return normalizeVi_(x); }).join(' \n ');

  if (isMultiWord && phrase) {
    if (kp.indexOf(phrase) !== -1 || topic.indexOf(phrase) !== -1) score += 55;
    if (concepts.indexOf(phrase) !== -1) score += 30;
    if (legal.indexOf(phrase) !== -1) score += 45;
  }
  // Điểm theo từng từ, có trọng số theo trường + tín hiệu phân tích.
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    if (title.indexOf(t) !== -1) score += 12;
    if (num.indexOf(t) !== -1) score += 10;
    if (issuer.indexOf(t) !== -1) score += 6;
    if (fname.indexOf(t) !== -1) score += 4;
    if (kp.indexOf(t) !== -1) score += 15;       // khớp key phrase
    if (topic.indexOf(t) !== -1) score += 10;    // khớp chủ đề
    if (concepts.indexOf(t) !== -1) score += 8;  // khớp khái niệm
    if (field.indexOf(t) !== -1) score += 8;     // khớp lĩnh vực
    if (legal.indexOf(t) !== -1) score += 18;    // khớp căn cứ pháp lý
    score += Math.min(countOcc_(content, t), 5); // tần suất trong nội dung (giới hạn 5)
  }
  return score;
}

/**
 * Tạo đoạn trích nội dung quanh CỤM TỪ (nếu khớp) hoặc từ khoá đầu tiên.
 */
function makeSnippet_(content, terms, phrase) {
  if (!content) return '';
  if (!terms || !terms.length) return content.substring(0, 160).replace(/\s+/g, ' ') + '…';
  var nContent = normalizeVi_(content);
  var pos = -1;
  if (phrase && phrase.indexOf(' ') !== -1) pos = nContent.indexOf(phrase); // ưu tiên vị trí cụm từ
  if (pos === -1) {
    for (var i = 0; i < terms.length; i++) {
      pos = nContent.indexOf(terms[i]);
      if (pos !== -1) break;
    }
  }
  if (pos === -1) return content.substring(0, 160).replace(/\s+/g, ' ') + '…';
  var start = Math.max(0, pos - 60);
  var snippet = content.substring(start, start + 200).replace(/\s+/g, ' ');
  return (start > 0 ? '…' : '') + snippet + '…';
}

/**
 * Lấy chi tiết 1 văn bản (kèm full content + hồ sơ phân tích đã tách sẵn cho giao diện).
 */
function getDocDetail(fileId) {
  var d = getDocDetailFast_(fileId); // đọc đúng 1 dòng thay vì toàn bộ CSDL -> mở văn bản nhanh
  if (d) {
    d.analysisObj = parseAnalysis_(d.analysis);
    d.relationsResolved = resolveRelations_(d.relations); // tiêu đề các văn bản liên kết cho UI
  }
  return d;
}

/* ===================== Duplicate.gs ===================== */
/**
 * Duplicate.gs
 * Rà soát & phát hiện văn bản TRÙNG LẶP.
 * Tiêu chí: trùng số/ký hiệu, trùng nội dung (băm MD5), hoặc trùng tiêu đề + ngày ban hành.
 * Gộp nhóm bằng thuật toán union-find (các văn bản chia sẻ bất kỳ dấu hiệu nào -> cùng nhóm).
 */

function md5_(s) {
  return toHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8));
}

// Các "dấu hiệu" nhận diện trùng của 1 văn bản.
function docSignatures_(d, includeContent) {
  var sigs = [];
  var num = normalizeVi_(d.docNumber || '').replace(/\s+/g, '').replace(/[^a-z0-9\/\-]/g, '');
  if (num && num.length >= 3) sigs.push('num:' + num);
  if (includeContent) {
    var c = normalizeVi_(d.content || '').replace(/\s+/g, ' ').trim();
    if (c.length >= 150) sigs.push('hash:' + md5_(c.substring(0, 4000)));
  }
  var t = normalizeVi_(d.title || '').replace(/\s+/g, ' ').trim();
  if (t.length >= 15 && d.issuedDate) sigs.push('td:' + t + '|' + d.issuedDate);
  return sigs;
}

var DUP_REASON_LABEL = { num: 'Trùng số/ký hiệu', hash: 'Trùng nội dung', td: 'Trùng tiêu đề + ngày' };

function groupDuplicates_(docs, includeContent) {
  var n = docs.length;
  var parent = new Array(n);
  for (var i = 0; i < n; i++) parent[i] = i;
  function find(x) { var r = x; while (parent[r] !== r) r = parent[r]; while (parent[x] !== r) { var t = parent[x]; parent[x] = r; x = t; } return r; }
  function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  var sigFirst = {};
  var allSigs = new Array(n);
  for (var i = 0; i < n; i++) {
    var sigs = docSignatures_(docs[i], includeContent);
    allSigs[i] = sigs;
    for (var s = 0; s < sigs.length; s++) {
      var sig = sigs[s];
      if (sigFirst[sig] != null) union(i, sigFirst[sig]);
      else sigFirst[sig] = i;
    }
  }

  var groups = {};
  for (var i = 0; i < n; i++) { var r = find(i); (groups[r] = groups[r] || []).push(i); }

  var out = [];
  Object.keys(groups).forEach(function (r) {
    var members = groups[r];
    if (members.length < 2) return;
    // Lý do: các loại dấu hiệu xuất hiện >=2 lần trong nhóm.
    var counts = {};
    members.forEach(function (mi) {
      allSigs[mi].forEach(function (sig) { counts[sig] = (counts[sig] || 0) + 1; });
    });
    var reasons = {};
    Object.keys(counts).forEach(function (sig) {
      if (counts[sig] >= 2) { reasons[DUP_REASON_LABEL[sig.split(':')[0]] || sig] = true; }
    });
    out.push({
      reason: Object.keys(reasons).join(', ') || 'Nghi ngờ trùng',
      docs: members.map(function (mi) {
        var d = docs[mi];
        return {
          fileId: d.fileId, fileName: d.fileName, title: d.title, docType: d.docType,
          docNumber: d.docNumber, issuedDate: d.issuedDate, issuer: d.issuer,
          fileUrl: d.fileUrl, ocrStatus: d.ocrStatus
        };
      })
    });
  });
  out.sort(function (a, b) { return b.docs.length - a.docs.length; });
  return { groups: out, total: out.length, docsAffected: out.reduce(function (s, g) { return s + g.docs.length; }, 0) };
}

/**
 * Rà soát trùng lặp đầy đủ (bao gồm so khớp nội dung). Dùng cho nút "Rà soát trùng lặp".
 */
function findDuplicates() {
  var res = groupDuplicates_(readAllDocs(), true);
  PropertiesService.getScriptProperties().setProperty(PROP_DUP_COUNT, String(res.docsAffected));
  return res;
}

/**
 * Đọc "nhẹ" các cột cần cho rà soát nhanh (không đọc cột nội dung).
 */
function readLightDocs_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = lastRow - 1;
  // Cột 1..7: FileId, FileName, DocType, DocTypeCode, DocNumber, IssuedDate, Title (không có nội dung).
  var vals = sheet.getRange(2, 1, n, COLS.TITLE + 1).getValues();
  return vals.map(function (r) {
    return {
      fileId: cell_(r[COLS.FILE_ID]),
      fileName: cell_(r[COLS.FILE_NAME]),
      docType: cell_(r[COLS.DOC_TYPE]),
      docNumber: cell_(r[COLS.DOC_NUMBER]),
      issuedDate: dateCell_(r[COLS.ISSUED_DATE]),
      title: cell_(r[COLS.TITLE]),
      content: '' , issuer: '', fileUrl: ''
    };
  });
}

/**
 * Cập nhật nhanh số văn bản nghi trùng (theo số hiệu + tiêu đề/ngày, không đọc nội dung).
 * Gọi sau mỗi lần quét.
 */
function refreshDuplicateCount_() {
  try {
    var res = groupDuplicates_(readLightDocs_(), false);
    PropertiesService.getScriptProperties().setProperty(PROP_DUP_COUNT, String(res.docsAffected));
    return res.docsAffected;
  } catch (e) { return 0; }
}

function getDuplicateCount_() {
  return parseInt(PropertiesService.getScriptProperties().getProperty(PROP_DUP_COUNT), 10) || 0;
}

/* ===================== Trash.gs ===================== */
/**
 * Trash.gs
 * Thùng rác trong app: xoá văn bản sẽ chuyển sang sheet "ThungRac" (kèm file Drive vào
 * Thùng rác Drive), có thể khôi phục hoặc xoá vĩnh viễn.
 */

var TRASH_SHEET = 'ThungRac';

function getTrashSheet_() {
  var ss = getOrCreateDatabase();
  var sh = ss.getSheetByName(TRASH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TRASH_SHEET);
    var headers = DB_HEADERS.concat(['Xoá lúc', 'Người xoá']);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#8B0000').setFontColor('#ffffff');
  }
  return sh;
}

/**
 * Xoá văn bản -> đưa vào thùng rác (giữ nguyên bản ghi để khôi phục) + chuyển file Drive vào Thùng rác.
 */
function deleteDocToTrash_(fileId, byEmail) {
  if (!fileId) throw new Error('Thiếu mã văn bản.');
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Không có dữ liệu.');
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  var rowIndex = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(fileId)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) throw new Error('Không tìm thấy văn bản trong danh sách.');

  var rowVals = sheet.getRange(rowIndex, 1, 1, DB_HEADERS.length).getValues()[0];
  // Ghi vào thùng rác
  var trash = getTrashSheet_();
  trash.appendRow(rowVals.concat([new Date(), byEmail || '']));
  // Xoá khỏi danh sách chính
  sheet.deleteRow(rowIndex);
  // Đưa file vào Thùng rác Drive
  var trashed = false;
  try { DriveApp.getFileById(fileId).setTrashed(true); trashed = true; } catch (e) {}
  writeLog_('Xoá vào thùng rác', 1, (rowVals[COLS.FILE_NAME] || fileId));
  return { ok: true, trashed: trashed };
}

/**
 * Danh sách văn bản trong thùng rác.
 */
function listTrash_() {
  var trash = getTrashSheet_();
  var lastRow = trash.getLastRow();
  if (lastRow < 2) return [];
  var w = DB_HEADERS.length + 2;
  var vals = trash.getRange(2, 1, lastRow - 1, w).getValues();
  return vals.map(function (r) {
    var d = rowToObj_(r);
    d.deletedAt = cell_(r[DB_HEADERS.length]);
    d.deletedBy = cell_(r[DB_HEADERS.length + 1]);
    return d;
  }).reverse(); // mới xoá lên đầu
}

function findTrashRow_(trash, fileId) {
  var lastRow = trash.getLastRow();
  if (lastRow < 2) return -1;
  var ids = trash.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(fileId)) return i + 2;
  }
  return -1;
}

/**
 * Khôi phục 1 văn bản từ thùng rác về danh sách + phục hồi file Drive.
 */
function restoreDoc_(fileId) {
  var trash = getTrashSheet_();
  var row = findTrashRow_(trash, fileId);
  if (row === -1) throw new Error('Không tìm thấy trong thùng rác.');
  var rowVals = trash.getRange(row, 1, 1, DB_HEADERS.length).getValues()[0];
  // Phục hồi file Drive
  try { DriveApp.getFileById(fileId).setTrashed(false); } catch (e) {}
  // Đưa lại vào danh sách chính (nếu chưa có)
  var sheet = getDocsSheet_();
  var existing = getExistingIndex_();
  if (!existing[fileId]) sheet.appendRow(rowVals);
  trash.deleteRow(row);
  writeLog_('Khôi phục văn bản', 1, (rowVals[COLS.FILE_NAME] || fileId));
  return { ok: true };
}

/**
 * Xoá vĩnh viễn 1 văn bản khỏi thùng rác (bản ghi). File vẫn ở Thùng rác Drive (Drive tự dọn sau ~30 ngày).
 */
function purgeDoc_(fileId) {
  var trash = getTrashSheet_();
  var row = findTrashRow_(trash, fileId);
  if (row === -1) throw new Error('Không tìm thấy trong thùng rác.');
  trash.deleteRow(row);
  writeLog_('Xoá vĩnh viễn', 1, fileId);
  return { ok: true };
}

function emptyTrash_() {
  var trash = getTrashSheet_();
  var lastRow = trash.getLastRow();
  var count = Math.max(0, lastRow - 1);
  if (lastRow > 1) trash.deleteRows(2, lastRow - 1);
  writeLog_('Dọn sạch thùng rác', count, '');
  return { ok: true, removed: count };
}

function trashCount_() {
  try { return Math.max(0, getTrashSheet_().getLastRow() - 1); } catch (e) { return 0; }
}

/* ===================== Audit.gs ===================== */
/**
 * Audit.gs
 * Nhật ký hoạt động: ghi lại thao tác của người dùng (ai, làm gì, khi nào) vào sheet "NhatKyHD".
 */

var AUDIT_SHEET = 'NhatKyHD';
var AUDIT_HEADERS = ['Thời điểm', 'Người dùng', 'Hành động', 'Chi tiết'];

// Nhãn tiếng Việt cho các thao tác được ghi log.
var AUDIT_ACTIONS = {
  login: 'Đăng nhập',
  updateDoc: 'Sửa văn bản',
  deleteDoc: 'Xoá văn bản',
  restoreDoc: 'Khôi phục văn bản',
  purgeDoc: 'Xoá vĩnh viễn',
  emptyTrash: 'Dọn thùng rác',
  reOcr: 'OCR lại',
  scan: 'Quét Drive',
  uploadFile: 'Tải file lên',
  ocrQueueRun: 'Chạy hàng đợi OCR',
  setAutoScan: 'Đổi lịch quét',
  setOcrAuto: 'Đổi lịch OCR',
  setOcrLimit: 'Đổi hạn mức OCR',
  saveDocTypes: 'Sửa loại VB',
  saveIssuers: 'Sửa đơn vị',
  setVisionKey: 'Đổi Vision key',
  changePassword: 'Đổi mật khẩu',
  saveAccount: 'Lưu tài khoản',
  deleteAccount: 'Xoá tài khoản',
  resetPassword: 'Đặt lại mật khẩu',
  initialize: 'Khởi tạo hệ thống'
};

function getAuditSheet_() {
  var ss = getOrCreateDatabase();
  var sh = ss.getSheetByName(AUDIT_SHEET);
  if (!sh) {
    sh = ss.insertSheet(AUDIT_SHEET);
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setValues([AUDIT_HEADERS]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, AUDIT_HEADERS.length).setFontWeight('bold')
      .setBackground('#0B5394').setFontColor('#ffffff');
  }
  return sh;
}

function auditLog_(email, method, detail) {
  try {
    var action = AUDIT_ACTIONS[method] || method;
    getAuditSheet_().appendRow([new Date(), email || '', action, detail || '']);
  } catch (e) { /* không để log làm hỏng luồng chính */ }
}

// Tạo mô tả ngắn cho log từ payload của phương thức.
function auditDetail_(method, payload) {
  payload = payload || {};
  if (method === 'updateDocsBatch') return (payload.fileIds ? payload.fileIds.length : 0) + ' văn bản';
  if (payload.fileId) return 'fileId: ' + payload.fileId;
  if (payload.email) return payload.email;
  if (method === 'scan') return payload.force ? 'quét lại toàn bộ' : 'quét thường';
  return '';
}

/**
 * Lấy N dòng nhật ký gần nhất (mới -> cũ).
 */
function listAudit_(limit) {
  limit = limit || 200;
  var sh = getAuditSheet_();
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return [];
  var n = Math.min(limit, lastRow - 1);
  var start = lastRow - n + 1;
  var vals = sh.getRange(start, 1, n, AUDIT_HEADERS.length).getValues();
  return vals.map(function (r) {
    return {
      time: (r[0] instanceof Date) ? r[0].toISOString() : String(r[0]),
      user: String(r[1] || ''),
      action: String(r[2] || ''),
      detail: String(r[3] || '')
    };
  }).reverse();
}

/* ===================== Export.gs ===================== */
/**
 * Export.gs
 * Xuất danh mục văn bản ra CSV (mở được bằng Excel) theo đúng bộ lọc đang tìm kiếm.
 */

function csvCell_(v) {
  v = (v == null) ? '' : String(v);
  if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csvDate_(iso) {
  if (!iso) return '';
  var p = String(iso).substring(0, 10).split('-');
  return (p.length === 3) ? (p[2] + '/' + p[1] + '/' + p[0]) : String(iso);
}

/**
 * Trả về { csv, count, filename } cho danh mục văn bản khớp bộ lọc.
 */
function exportDocsCsv_(query) {
  query = query || {};
  query.page = 1;
  query.pageSize = 100000; // lấy tất cả kết quả khớp
  var res = searchDocs(query);

  var headers = ['STT', 'Số/Ký hiệu', 'Loại văn bản', 'Trích yếu', 'Ngày ban hành',
    'Đơn vị ban hành', 'Cấp ban hành', 'Lĩnh vực', 'Hiệu lực', 'Trạng thái xử lý', 'Tên file', 'Link Drive'];
  var lines = [headers.map(csvCell_).join(',')];
  res.items.forEach(function (d, i) {
    var row = [
      i + 1, d.docNumber, d.docType, d.title, csvDate_(d.issuedDate),
      d.issuer, d.issuerLevel, d.field, d.validity, d.procStatus, d.fileName, d.fileUrl
    ];
    lines.push(row.map(csvCell_).join(','));
  });

  return {
    csv: lines.join('\r\n'),
    count: res.items.length,
    filename: 'DanhMucVanBan_' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmm') + '.csv'
  };
}

/* ===================== Upload.gs ===================== */
/**
 * Upload.gs
 * Tải file lên trực tiếp trong app: lưu vào folder gốc trên Drive rồi lập chỉ mục ngay
 * (ảnh/PDF sẽ được xếp hàng đợi OCR như khi quét).
 */

function uploadFile_(p, acc) {
  if (!p || !p.dataBase64 || !p.name) throw new Error('Thiếu dữ liệu file.');
  var bytes = Utilities.base64Decode(p.dataBase64);
  var blob = Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.name);

  var folder = getOrCreateRootFolder();
  var file = folder.createFile(blob);

  var existing = getExistingIndex_();
  var f = {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    url: file.getUrl(),
    modifiedTime: file.getLastUpdated().getTime(),
    createdDate: file.getDateCreated(),
    folderPath: '/'
  };
  var doc = processFile_(f, existing);
  refreshDuplicateCount_(); // cập nhật số nghi trùng

  return {
    ok: true,
    fileId: doc.fileId,
    fileName: doc.fileName,
    docType: doc.docType,
    docTypeCode: doc.docTypeCode,
    docNumber: doc.docNumber,
    ocrStatus: doc.ocrStatus
  };
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
var PERM_KEYS = ['view', 'edit', 'delete', 'scan', 'config', 'accounts'];
var PERM_LABELS = {
  view: 'Xem & tìm kiếm',
  edit: 'Sửa thông tin văn bản',
  delete: 'Xoá văn bản',
  scan: 'Quét & OCR',
  config: 'Cấu hình (loại VB, đơn vị, OCR...)',
  accounts: 'Quản lý tài khoản'
};

function rolePerms_(role) {
  if (role === 'admin') return { view: true, edit: true, delete: true, scan: true, config: true, accounts: true };
  if (role === 'editor') return { view: true, edit: true, delete: false, scan: true, config: false, accounts: false };
  // 'viewer' và 'free' đều chỉ có quyền xem/tìm kiếm.
  return { view: true, edit: false, delete: false, scan: false, config: false, accounts: false };
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

// Tài khoản KHÁCH (chưa đăng nhập): quyền chỉ xem, giống tài khoản Xem.
function guestAccount_() {
  return { email: '', name: 'Khách', role: 'guest', active: true, perms: rolePerms_('viewer') };
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
  var validRoles = { admin: 1, editor: 1, viewer: 1, free: 1 };
  var role = validRoles[p.role] ? p.role : 'viewer';
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
  tpl.logoUri = getLogoDataUri_(); // logo.png trong folder gốc (nếu có), dạng data URI
  return tpl.evaluate()
    .setTitle('QLVB - Đại học Điện lực')
    .setFaviconUrl('https://ssl.gstatic.com/docs/script/images/favicon.ico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Đọc logo (logo.png/.jpg...) trong folder gốc trên Drive -> data URI để nhúng vào trang.
 * Trả '' nếu chưa có (giao diện sẽ dùng logo SVG dự phòng).
 */
function getLogoDataUri_() {
  try {
    var folder = getExistingRootFolder_();
    if (!folder) return '';
    // 1) Thử tên chính xác (nhanh).
    var names = ['logo.png', 'logo.jpg', 'logo.jpeg', 'logo.gif', 'logo.webp', 'logo.svg'];
    for (var i = 0; i < names.length; i++) {
      var it = folder.getFilesByName(names[i]);
      if (it.hasNext()) return blobToDataUri_(it.next().getBlob());
    }
    // 2) Quét (giới hạn) để bắt các biến thể tên (Logo.PNG, logo (1).png...).
    var files = folder.getFiles();
    var scanned = 0;
    while (files.hasNext() && scanned < 400) {
      scanned++;
      var f = files.next();
      var n = f.getName().toLowerCase();
      if (/(^|[^a-z])logo[^a-z0-9]*\.(png|jpg|jpeg|gif|webp|svg)$/.test(n) || n.indexOf('logo') === 0) {
        var ct = f.getBlob().getContentType() || '';
        if (ct.indexOf('image/') === 0) return blobToDataUri_(f.getBlob());
      }
    }
  } catch (e) { /* bỏ qua, dùng logo dự phòng */ }
  return '';
}
function blobToDataUri_(blob) {
  var ct = blob.getContentType() || 'image/png';
  return 'data:' + ct + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/**
 * Chẩn đoán logo: app đang dùng folder gốc nào, có thấy file 'logo*' không.
 */
function getLogoInfo_() {
  var folder = getExistingRootFolder_();
  if (!folder) return { ok: false, message: 'Chưa cấu hình folder gốc. Hãy Khởi tạo hệ thống / Quét trước.' };
  var info = {
    ok: true,
    rootFolderName: folder.getName(),
    rootFolderId: folder.getId(),
    rootFolderUrl: folder.getUrl(),
    logoFilesInRoot: [],
    found: false,
    uriLength: 0
  };
  try {
    var it = folder.getFiles(); var n = 0;
    while (it.hasNext() && n < 100) {
      n++; var f = it.next(); var nm = f.getName();
      if (nm.toLowerCase().indexOf('logo') !== -1) {
        info.logoFilesInRoot.push({ name: nm, mime: f.getMimeType(), size: f.getSize() });
      }
    }
  } catch (e) {}
  var uri = getLogoDataUri_();
  info.found = !!uri;
  info.uriLength = uri ? uri.length : 0;
  return info;
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
  search: 'view', getDetail: 'view', getStats: 'view', getUploadInfo: 'view', findDuplicates: 'view',
  exportCsv: 'view', getRelated: 'view',
  updateDoc: 'edit', updateDocsBatch: 'edit', reOcr: 'edit', deleteDoc: 'delete',
  listTrash: 'delete', restoreDoc: 'delete', purgeDoc: 'delete', emptyTrash: 'delete',
  scan: 'scan', ocrQueueRun: 'scan', setOcrAuto: 'scan', setOcrLimit: 'scan', setAutoScan: 'scan',
  uploadFile: 'scan',
  saveDocTypes: 'config', resetDocTypes: 'config', saveIssuers: 'config', resetIssuers: 'config',
  saveFields: 'config', resetFields: 'config',
  setVisionKey: 'config', testVision: 'config', initialize: 'config', logoInfo: 'config',
  getStorageConfig: 'config', setStorageFolder: 'config',
  listAccounts: 'accounts', saveAccount: 'accounts', deleteAccount: 'accounts', resetPassword: 'accounts',
  listAudit: 'accounts'
};

// Các thao tác cần ghi nhật ký hoạt động.
var AUDIT_METHODS = {
  updateDoc: 1, updateDocsBatch: 1, deleteDoc: 1, restoreDoc: 1, purgeDoc: 1, emptyTrash: 1, reOcr: 1, scan: 1,
  uploadFile: 1, saveDocTypes: 1, saveIssuers: 1, saveFields: 1, setVisionKey: 1, changePassword: 1,
  saveAccount: 1, deleteAccount: 1, resetPassword: 1, initialize: 1,
  setAutoScan: 1, setOcrAuto: 1, setOcrLimit: 1, setStorageFolder: 1
};

/**
 * Điểm vào DUY NHẤT cho giao diện. Xác thực token + kiểm tra quyền rồi mới thực thi.
 */
function apiDispatch(token, method, payload) {
  payload = payload || {};
  if (method === 'login') {
    var r = authLogin_(payload.email, payload.password);
    auditLog_(payload.email, 'login', '');
    return r;
  }

  if (!METHOD_PERM.hasOwnProperty(method)) throw new Error('Chức năng không hợp lệ.');
  var need = METHOD_PERM[method];

  // Chưa đăng nhập -> dùng tài khoản KHÁCH (chỉ xem). Chức năng cần quyền cao hơn phải đăng nhập.
  var acc = null;
  try { acc = authVerify_(token); } catch (e) { acc = null; }
  if (!acc) {
    var guestOk = (need === null || need === 'view') && method !== 'changePassword';
    if (!guestOk) throw new Error('AUTH: Vui lòng đăng nhập để sử dụng chức năng này.');
    acc = guestAccount_();
  } else if (need && need !== 'PUBLIC' && !acc.perms[need]) {
    throw new Error('Bạn không có quyền thực hiện chức năng này.');
  }

  var result = routeMethod_(method, payload, acc);
  if (AUDIT_METHODS[method]) auditLog_(acc.email, method, auditDetail_(method, payload));
  return result;
}

function routeMethod_(method, payload, acc) {
  switch (method) {
    case 'getStatus':    return apiGetStatus(acc);
    case 'changePassword': return changePassword_(acc, payload.oldPassword, payload.newPassword);
    case 'logout':       return { ok: true };
    case 'search':       return searchDocs(payload);
    case 'getDetail':    return getDocDetail(payload.fileId);
    case 'getRelated':   return getRelatedDocs_(payload.fileId, payload.limit);
    case 'getStats':     return apiGetStats();
    case 'findDuplicates': return findDuplicates();
    case 'getUploadInfo': return apiGetUploadInfo();
    case 'updateDoc':    return updateDocManual(payload);
    case 'updateDocsBatch': return updateDocsBatch_(payload.fileIds, payload.fields);
    case 'reOcr':        return reOcrDoc(payload.fileId);
    case 'deleteDoc':    return deleteDocToTrash_(payload.fileId, acc.email);
    case 'listTrash':    return listTrash_();
    case 'restoreDoc':   return restoreDoc_(payload.fileId);
    case 'purgeDoc':     return purgeDoc_(payload.fileId);
    case 'emptyTrash':   return emptyTrash_();
    case 'scan':         return scanDrive({ force: !!payload.force });
    case 'ocrQueueRun':  return apiOcrQueueRun();
    case 'setOcrAuto':   return apiSetOcrAuto(payload.enable, payload.hours);
    case 'setOcrLimit':  return apiSetOcrLimit(payload.n);
    case 'setAutoScan':  return apiSetAutoScan(payload.enable, payload.hours);
    case 'saveDocTypes': return saveDocTypes(payload.docTypes || payload);
    case 'resetDocTypes': return apiResetDocTypes();
    case 'saveIssuers':  return saveIssuers(payload.issuers || payload);
    case 'resetIssuers': return apiResetIssuers();
    case 'saveFields':   return saveFields(payload.fields || payload);
    case 'resetFields':  return apiResetFields();
    case 'setVisionKey': return apiSetVisionKey(payload.key);
    case 'testVision':   return apiTestVision();
    case 'initialize':   return apiInitialize(acc);
    case 'logoInfo':     return getLogoInfo_();
    case 'getStorageConfig': return apiGetStorageConfig(acc);
    case 'setStorageFolder': return apiSetStorageFolder(acc, payload.input);
    case 'listAccounts': return listAccounts_();
    case 'saveAccount':  return saveAccount_(payload);
    case 'deleteAccount': return deleteAccount_(payload.email, acc.email);
    case 'resetPassword': return adminResetPassword_(payload.email, payload.newPassword);
    case 'listAudit':    return listAudit_(payload.limit);
    case 'exportCsv':    return exportDocsCsv_(payload);
    case 'uploadFile':   return uploadFile_(payload, acc);
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

  // Lấy danh sách trigger 1 lần cho cả 2 kiểm tra (nhanh hơn gọi getProjectTriggers 2 lần).
  var hasAuto = false, hasOcr = false;
  try {
    var triggers = ScriptApp.getProjectTriggers();
    for (var t = 0; t < triggers.length; t++) {
      var h = triggers[t].getHandlerFunction();
      if (h === 'autoScanJob') hasAuto = true;
      else if (h === 'ocrQueueJob') hasOcr = true;
    }
  } catch (e) {}

  return {
    initialized: !!(rootId && dbId),
    rootFolder: rootFolder,
    database: dbFile,
    lastScan: lastScan,
    autoScan: hasAuto,
    docTypes: getDocTypes(),
    issuers: getIssuers(),
    issuerLevels: getIssuerLevels(),
    fields: getFieldDictionary(),
    fieldNames: getFieldNames(),
    validityOptions: getValidityOptions(),
    procStatusOptions: getProcessingStatuses(),
    totalDocs: countDocs_(),
    visionEnabled: hasVisionKey_(),
    ocrPending: ocrQueueCount(),
    ocrAuto: hasOcr,
    ocrDailyLimit: getOcrDailyLimit(),
    ocrUsedToday: ocrUsedToday_(),
    duplicates: getDuplicateCount_(),
    trashCount: trashCount_(),
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
  var byType = {};
  var byYear = {};
  var byLevel = {};
  var typeNames = {};
  getDocTypes().forEach(function (t) { typeNames[t.code] = t.name; });

  // Chỉ đọc 3 cột cần thiết (mã loại, ngày ban hành, cấp) -> không đọc cột nội dung nặng.
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  var totalDocs = Math.max(0, lastRow - 1);
  if (lastRow >= 2) {
    var n = lastRow - 1;
    var codes = sheet.getRange(2, COLS.DOC_TYPE_CODE + 1, n, 1).getValues();
    var dates = sheet.getRange(2, COLS.ISSUED_DATE + 1, n, 1).getValues();
    var levels = sheet.getRange(2, COLS.ISSUER_LEVEL + 1, n, 1).getValues();
    for (var i = 0; i < n; i++) {
      var code = codes[i][0] || 'KHAC';
      byType[code] = (byType[code] || 0) + 1;
      var dv = dates[i][0];
      var year = (dv instanceof Date) ? String(dv.getFullYear())
        : ((String(dv || '').substring(0, 4)) || 'Không rõ');
      if (!year) year = 'Không rõ';
      byYear[year] = (byYear[year] || 0) + 1;
      var level = levels[i][0] || 'Chưa rõ';
      byLevel[level] = (byLevel[level] || 0) + 1;
    }
  }

  var typeStats = Object.keys(byType).map(function (code) {
    return { code: code, name: typeNames[code] || (code === 'KHAC' ? 'Khác' : code), count: byType[code] };
  }).sort(function (a, b) { return b.count - a.count; });

  var yearStats = Object.keys(byYear).map(function (y) {
    return { year: y, count: byYear[y] };
  }).sort(function (a, b) { return a.year < b.year ? 1 : -1; });

  var levelStats = Object.keys(byLevel).map(function (l) {
    return { level: l, count: byLevel[l] };
  }).sort(function (a, b) { return b.count - a.count; });

  return { total: totalDocs, byType: typeStats, byYear: yearStats, byLevel: levelStats };
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
 * Đặt lại danh mục Lĩnh vực về mặc định.
 */
function apiResetFields() {
  PropertiesService.getScriptProperties().deleteProperty(PROP_FIELDS);
  return getFieldDictionary();
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
 * (Admin) Xem cấu hình thư mục lưu trữ hiện tại. Chỉ quản trị viên (ADR-011).
 */
function apiGetStorageConfig(acc) {
  if (!acc || acc.role !== 'admin') throw new Error('Chỉ quản trị viên được xem cấu hình lưu trữ.');
  return getStorageConfig_();
}

/**
 * (Admin) Đổi thư mục lưu trữ (Database Folder) theo URL hoặc Folder ID. Chỉ quản trị viên.
 */
function apiSetStorageFolder(acc, input) {
  if (!acc || acc.role !== 'admin') throw new Error('Chỉ quản trị viên được đổi thư mục lưu trữ.');
  return setStorageFolder_(input);
}

/**
 * Trả link mở folder gốc để người dùng tải văn bản lên.
 */
function apiGetUploadInfo() {
  var folder = getOrCreateRootFolder();
  return { folderId: folder.getId(), folderUrl: folder.getUrl(), folderName: folder.getName() };
}

