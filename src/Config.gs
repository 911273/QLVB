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
