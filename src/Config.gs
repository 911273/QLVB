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
