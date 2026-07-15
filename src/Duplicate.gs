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
