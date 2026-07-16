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
    if (query.status && d.status !== query.status) return false;
    if (query.security && d.security !== query.security) return false;
    if (query.fromDate && (!d.issuedDate || d.issuedDate < query.fromDate)) return false;
    if (query.toDate && (!d.issuedDate || d.issuedDate > query.toDate)) return false;
    if (terms.length) {
      var hay = normalizeVi_([
        d.fileName, d.docNumber, d.title, d.docType, d.content, d.folderPath,
        d.issuer, d.issuerLevel
      ].join(' \n '));
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
      status: d.status,
      security: d.security,
      urgency: d.urgency,
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
  // Điểm theo từng từ, có trọng số theo trường.
  for (var i = 0; i < terms.length; i++) {
    var t = terms[i];
    if (title.indexOf(t) !== -1) score += 12;
    if (num.indexOf(t) !== -1) score += 10;
    if (issuer.indexOf(t) !== -1) score += 6;
    if (fname.indexOf(t) !== -1) score += 4;
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
 * Lấy chi tiết 1 văn bản (kèm full content).
 */
function getDocDetail(fileId) {
  return getDocDetailFast_(fileId); // đọc đúng 1 dòng thay vì toàn bộ CSDL -> mở văn bản nhanh
}
