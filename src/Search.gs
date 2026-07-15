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

  var filtered = docs.filter(function (d) {
    if (query.typeCode && d.docTypeCode !== query.typeCode) return false;
    if (query.fromDate && (!d.issuedDate || d.issuedDate < query.fromDate)) return false;
    if (query.toDate && (!d.issuedDate || d.issuedDate > query.toDate)) return false;
    if (terms.length) {
      var hay = normalizeVi_([
        d.fileName, d.docNumber, d.title, d.docType, d.content, d.folderPath
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
