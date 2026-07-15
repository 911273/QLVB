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
