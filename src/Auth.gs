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
