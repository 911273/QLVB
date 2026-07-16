/**
 * Keywords.gs
 * Tự động trích TỪ KHÓA của văn bản (từ tiêu đề + nội dung) và tìm TÀI LIỆU LIÊN QUAN.
 */

// Từ dừng tiếng Việt (đã bỏ dấu, chữ thường) - loại khỏi từ khóa.
var VI_STOPWORDS = {
  'cua': 1, 'va': 1, 'cac': 1, 'cho': 1, 'duoc': 1, 'trong': 1, 'la': 1, 'co': 1, 'mot': 1,
  'nhung': 1, 'de': 1, 'voi': 1, 'theo': 1, 'khi': 1, 'nay': 1, 'da': 1, 'tai': 1, 've': 1,
  'tu': 1, 'den': 1, 'cung': 1, 'nhu': 1, 'sau': 1, 'truoc': 1, 'do': 1, 'boi': 1, 'hoac': 1,
  'neu': 1, 'thi': 1, 'ma': 1, 'ra': 1, 'vao': 1, 'len': 1, 'xuong': 1, 'hon': 1, 'rat': 1,
  'se': 1, 'dang': 1, 'bi': 1, 'phai': 1, 'con': 1, 'nen': 1, 'tren': 1, 'duoi': 1, 'giua': 1,
  'ngoai': 1, 'cai': 1, 'nao': 1, 'gi': 1, 'ai': 1, 'dau': 1, 'sao': 1, 'the': 1, 'vi': 1,
  'nham': 1, 'qua': 1, 'lai': 1, 'nua': 1, 'chi': 1, 'chua': 1, 'hay': 1, 'tuy': 1, 'tuc': 1,
  'so': 1, 'ngay': 1, 'thang': 1, 'nam': 1, 'viec': 1
};

function isStopword_(nw) { return !!VI_STOPWORDS[nw]; }

/**
 * Trích danh sách từ khóa (ưu tiên cụm 2 từ có ý nghĩa) từ text. Trả mảng chuỗi (giữ dấu).
 */
function extractKeywords_(text, maxN) {
  maxN = maxN || 12;
  if (!text) return [];
  var raw = String(text).substring(0, 8000);
  // Tách token: giữ chữ cái (kể cả tiếng Việt) và số, phần khác thành khoảng trắng.
  var tokensRaw = raw.replace(/[^0-9A-Za-zÀ-ỹ\s]/g, ' ').split(/\s+/).filter(Boolean);
  var norm = tokensRaw.map(function (w) { return normalizeVi_(w); });

  var uni = {}, uniDisp = {};
  var bi = {}, biDisp = {};
  for (var i = 0; i < tokensRaw.length; i++) {
    var nw = norm[i];
    if (nw.length >= 3 && !isStopword_(nw) && !/^\d+$/.test(nw)) {
      uni[nw] = (uni[nw] || 0) + 1;
      if (!uniDisp[nw]) uniDisp[nw] = tokensRaw[i].toLowerCase();
    }
    // cụm 2 từ (bigram) khi cả 2 từ đều "có nghĩa"
    if (i + 1 < tokensRaw.length) {
      var n1 = norm[i], n2 = norm[i + 1];
      if (n1.length >= 2 && n2.length >= 2 && !isStopword_(n1) && !isStopword_(n2) &&
          !/^\d+$/.test(n1) && !/^\d+$/.test(n2)) {
        var key = n1 + ' ' + n2;
        bi[key] = (bi[key] || 0) + 1;
        if (!biDisp[key]) biDisp[key] = (tokensRaw[i] + ' ' + tokensRaw[i + 1]).toLowerCase();
      }
    }
  }

  // Chọn cụm 2 từ trước (ưu tiên), rồi bổ sung từ đơn KHÔNG nằm trong cụm đã chọn.
  var bigrams = Object.keys(bi).filter(function (k) { return bi[k] >= 2; })
    .sort(function (a, b) { return bi[b] - bi[a]; });
  var out = [], usedTok = {};
  for (var p = 0; p < bigrams.length && out.length < maxN; p++) {
    var k = bigrams[p];
    out.push(biDisp[k]);
    k.split(' ').forEach(function (w) { usedTok[w] = 1; }); // đánh dấu các từ thành phần
  }
  var unigrams = Object.keys(uni).filter(function (k) { return uni[k] >= 3 && !usedTok[k]; })
    .sort(function (a, b) { return uni[b] - uni[a]; });
  for (var q = 0; q < unigrams.length && out.length < maxN; q++) {
    out.push(uniDisp[unigrams[q]]);
  }
  return out;
}

// Tập từ khóa (đã chuẩn hoá) của 1 văn bản.
function keywordSet_(keywordsStr) {
  var set = {};
  String(keywordsStr || '').split(',').forEach(function (k) {
    var n = normalizeVi_(k).trim();
    if (n) set[n] = 1;
  });
  return set;
}

/**
 * Đọc "nhẹ" các cột cần cho tính liên quan (không đọc nội dung).
 */
function readRelatedDocs_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = lastRow - 1;
  var a = sheet.getRange(2, 1, n, COLS.TITLE + 1).getValues();               // cột 1..7 (không có nội dung)
  var b = sheet.getRange(2, COLS.ISSUER + 1, n, COLS.KEYWORDS - COLS.ISSUER + 1).getValues(); // ISSUER..KEYWORDS
  var kOff = COLS.KEYWORDS - COLS.ISSUER;
  var out = [];
  for (var i = 0; i < n; i++) {
    out.push({
      fileId: cell_(a[i][COLS.FILE_ID]),
      fileName: cell_(a[i][COLS.FILE_NAME]),
      docType: cell_(a[i][COLS.DOC_TYPE]),
      docTypeCode: cell_(a[i][COLS.DOC_TYPE_CODE]),
      docNumber: cell_(a[i][COLS.DOC_NUMBER]),
      issuedDate: dateCell_(a[i][COLS.ISSUED_DATE]),
      title: cell_(a[i][COLS.TITLE]),
      issuer: cell_(b[i][0]),
      issuerLevel: cell_(b[i][1]),
      keywords: cell_(b[i][kOff])
    });
  }
  return out;
}

/**
 * Tìm tài liệu liên quan tới 1 văn bản: dựa trên từ khóa chung + cùng loại/đơn vị/thời gian.
 */
function getRelatedDocs_(fileId, limit) {
  limit = limit || 8;
  var docs = readRelatedDocs_();
  var target = null;
  for (var i = 0; i < docs.length; i++) { if (docs[i].fileId === fileId) { target = docs[i]; break; } }
  if (!target) return [];

  var tSet = keywordSet_(target.keywords);
  var tTitle = normalizeVi_(target.title || '');
  var tYear = (target.issuedDate || '').substring(0, 4);

  var scored = [];
  for (var j = 0; j < docs.length; j++) {
    var d = docs[j];
    if (d.fileId === fileId) continue;
    var score = 0, shared = 0;
    var dSet = keywordSet_(d.keywords);
    Object.keys(dSet).forEach(function (k) {
      if (tSet[k]) shared++;
      // từ khóa của tài liệu này xuất hiện trong tiêu đề tài liệu đang xem
      else if (k.length >= 4 && tTitle.indexOf(k) !== -1) score += 3;
    });
    score += shared * 10;
    if (d.docTypeCode && d.docTypeCode === target.docTypeCode) score += 6;
    if (d.issuer && d.issuer === target.issuer) score += 8;
    else if (d.issuerLevel && d.issuerLevel === target.issuerLevel) score += 2;
    if (tYear && (d.issuedDate || '').substring(0, 4) === tYear) score += 2;

    if (score > 0) {
      scored.push({
        fileId: d.fileId, title: d.title, fileName: d.fileName, docType: d.docType,
        docNumber: d.docNumber, issuedDate: d.issuedDate, issuer: d.issuer,
        shared: shared, score: score
      });
    }
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
}
