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
