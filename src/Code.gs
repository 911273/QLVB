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
  search: 'view', getDetail: 'view', getStats: 'view', getUploadInfo: 'view',
  updateDoc: 'edit', reOcr: 'edit', deleteDoc: 'delete',
  scan: 'scan', ocrQueueRun: 'scan', setOcrAuto: 'scan', setOcrLimit: 'scan', setAutoScan: 'scan',
  saveDocTypes: 'config', resetDocTypes: 'config', saveIssuers: 'config', resetIssuers: 'config',
  setVisionKey: 'config', testVision: 'config', initialize: 'config', logoInfo: 'config',
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
    case 'deleteDoc':    return deleteDocById_(payload.fileId, payload.trashFile);
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
    case 'logoInfo':     return getLogoInfo_();
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
