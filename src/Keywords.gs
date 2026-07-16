/**
 * Keywords.gs
 * Phân tích nội dung: trích "hồ sơ từ khóa" (term + tần suất) cho mỗi văn bản, và
 * tìm TÀI LIỆU LIÊN QUAN bằng TF-IDF + độ tương đồng cosine (ưu tiên từ khóa đặc trưng).
 *
 * Cột "Từ khóa" lưu dạng: "khoa học|8, công nghệ|5, quy chế|4, ..." (term|tần suất).
 */

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
 * Trích hồ sơ term của 1 văn bản: mảng {t: hiển thị, n: chuẩn hoá, f: tần suất}.
 * Ưu tiên cụm 2 từ có nghĩa, kèm từ đơn đặc trưng.
 */
function extractTermProfile_(text, maxN) {
  maxN = maxN || 25;
  if (!text) return [];
  var raw = String(text).substring(0, 12000);
  var tokensRaw = raw.replace(/[^0-9A-Za-zÀ-ỹ\s]/g, ' ').split(/\s+/).filter(Boolean);
  var norm = tokensRaw.map(function (w) { return normalizeVi_(w); });

  var uni = {}, uniDisp = {}, bi = {}, biDisp = {};
  for (var i = 0; i < tokensRaw.length; i++) {
    var nw = norm[i];
    if (nw.length >= 3 && !isStopword_(nw) && !/^\d+$/.test(nw)) {
      uni[nw] = (uni[nw] || 0) + 1;
      if (!uniDisp[nw]) uniDisp[nw] = tokensRaw[i].toLowerCase();
    }
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

  // Ưu tiên cụm 2 từ; loại từ đơn nằm trong cụm đã chọn.
  var bigrams = Object.keys(bi).filter(function (k) { return bi[k] >= 2; })
    .sort(function (a, b) { return bi[b] - bi[a]; });
  var out = [], usedTok = {};
  for (var p = 0; p < bigrams.length && out.length < maxN; p++) {
    var k = bigrams[p];
    out.push({ t: biDisp[k], n: k, f: bi[k] });
    k.split(' ').forEach(function (w) { usedTok[w] = 1; });
  }
  var unigrams = Object.keys(uni).filter(function (k) { return uni[k] >= 2 && !usedTok[k]; })
    .sort(function (a, b) { return uni[b] - uni[a]; });
  for (var q = 0; q < unigrams.length && out.length < maxN; q++) {
    out.push({ t: uniDisp[unigrams[q]], n: unigrams[q], f: uni[unigrams[q]] });
  }
  return out;
}

function profileToString_(profile) {
  return profile.map(function (x) { return x.t + '|' + x.f; }).join(', ');
}
function parseProfile_(str) {
  var out = [];
  String(str || '').split(',').forEach(function (item) {
    item = item.trim();
    if (!item) return;
    var pos = item.lastIndexOf('|');
    var t = pos === -1 ? item : item.substring(0, pos);
    var f = pos === -1 ? 1 : (parseInt(item.substring(pos + 1), 10) || 1);
    var n = normalizeVi_(t).trim();
    if (n) out.push({ t: t.trim(), n: n, f: f });
  });
  return out;
}

// Chuỗi từ khóa để lưu vào CSDL (từ tiêu đề + nội dung).
function computeKeywords_(text) {
  return profileToString_(extractTermProfile_(text, 25));
}

/**
 * Đọc "nhẹ" các cột cần cho tính liên quan (không đọc nội dung).
 */
function readRelatedDocs_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = lastRow - 1;
  var a = sheet.getRange(2, 1, n, COLS.TITLE + 1).getValues();
  var b = sheet.getRange(2, COLS.ISSUER + 1, n, COLS.KEYWORDS - COLS.ISSUER + 1).getValues();
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
 * Tìm tài liệu liên quan: TF-IDF + cosine trên hồ sơ từ khóa, cộng thưởng cùng
 * loại/đơn vị/năm. Ưu tiên văn bản chia sẻ từ khóa ĐẶC TRƯNG (hiếm trong kho).
 */
function getRelatedDocs_(fileId, limit) {
  limit = limit || 8;
  var docs = readRelatedDocs_();
  var N = docs.length;
  if (N < 2) return [];

  var profiles = docs.map(function (d) { return parseProfile_(d.keywords); });

  // Document frequency + IDF
  var df = {};
  for (var i = 0; i < N; i++) {
    var seen = {};
    for (var j = 0; j < profiles[i].length; j++) {
      var t = profiles[i][j].n;
      if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; }
    }
  }
  function idf(t) { return Math.log(1 + N / ((df[t] || 0) + 0.5)); }

  // Vector TF-IDF của 1 hồ sơ.
  function vec(profile) {
    var v = {}, norm2 = 0;
    for (var k = 0; k < profile.length; k++) {
      var t = profile[k].n;
      var w = (1 + Math.log(profile[k].f)) * idf(t); // tf (log) * idf
      v[t] = w; norm2 += w * w;
    }
    return { v: v, len: Math.sqrt(norm2) || 1 };
  }

  var ti = -1;
  for (var x = 0; x < N; x++) if (docs[x].fileId === fileId) { ti = x; break; }
  if (ti === -1) return [];
  var target = docs[ti];
  var tv = vec(profiles[ti]);
  var tYear = (target.issuedDate || '').substring(0, 4);

  var scored = [];
  for (var m = 0; m < N; m++) {
    if (m === ti) continue;
    var d = docs[m];
    var ov = vec(profiles[m]);
    // cosine = dot / (|tv||ov|)
    var dot = 0, shared = 0;
    var keys = Object.keys(tv.v);
    for (var y = 0; y < keys.length; y++) {
      var t = keys[y];
      if (ov.v[t]) { dot += tv.v[t] * ov.v[t]; shared++; }
    }
    var cosine = dot / (tv.len * ov.len);
    var score = cosine * 100; // 0..100 theo độ giống nội dung
    if (d.docTypeCode && d.docTypeCode === target.docTypeCode) score += 5;
    if (d.issuer && d.issuer === target.issuer) score += 6;
    else if (d.issuerLevel && d.issuerLevel === target.issuerLevel) score += 2;
    if (tYear && (d.issuedDate || '').substring(0, 4) === tYear) score += 2;

    if (score >= 3) {
      scored.push({
        fileId: d.fileId, title: d.title, fileName: d.fileName, docType: d.docType,
        docNumber: d.docNumber, issuedDate: d.issuedDate, issuer: d.issuer,
        shared: shared, similarity: Math.round(cosine * 100), score: score
      });
    }
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
}
