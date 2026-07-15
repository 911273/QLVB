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
