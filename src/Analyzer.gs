/**
 * Analyzer.gs
 * Động cơ PHÂN TÍCH NỘI DUNG & KHÁM PHÁ tài liệu (không gọi API ngoài).
 *
 * Với mỗi văn bản, phân tích nội dung OCR + metadata để rút:
 *   - topic     : chủ đề chính (key phrase tiêu biểu nhất)
 *   - field     : lĩnh vực (theo từ điển trong Config)
 *   - concepts  : các khái niệm quan trọng (key phrases mở rộng, phục vụ độ liên quan)
 *   - entities  : đối tượng/đơn vị được nhắc tới
 *   - legalRefs : căn cứ pháp lý / tiêu chuẩn (Nghị định, Thông tư, QĐ số, Luật, TCVN/QCVN/ISO...)
 *
 * Hồ sơ phân tích được LƯU (cột "Phân tích" dạng JSON) và chỉ tính lại khi OCR xong
 * hoặc khi văn bản được cập nhật — KHÔNG tính trong lúc tìm kiếm.
 *
 * Tài liệu liên quan được xếp hạng ĐA YẾU TỐ: nội dung (TF-IDF/cosine trên khái niệm) +
 * căn cứ pháp lý dùng chung + lĩnh vực + tiêu đề + loại/đơn vị/cấp/năm.
 */

/* ===================== TRÍCH TÍN HIỆU PHÂN TÍCH ===================== */

/**
 * Nhận diện căn cứ pháp lý / tiêu chuẩn trong văn bản. Trả mảng chuỗi (đã khử trùng theo dạng
 * chuẩn hoá), giữ bản hiển thị gần với văn bản gốc.
 */
function detectLegalRefs_(text) {
  var s = String(text || '');
  var found = {}, order = [];
  function add(x) {
    var disp = x.replace(/\s+/g, ' ').replace(/[.,;:]+$/, '').trim();
    var key = normalizeVi_(disp);
    if (key && !found.hasOwnProperty(key)) { found[key] = disp; order.push(key); }
  }
  var patterns = [
    /\b(TCVN|QCVN|ISO|IEC)\s*[:\-]?\s*\d[\d.\-:\/]*/gi,               // tiêu chuẩn
    /\b\d{1,4}\/\d{2,4}\/[A-Za-zĐđ][A-Za-zĐđ0-9\-]*/g,                 // 08/2021/TT-BGDĐT
    /(nghị định|thông tư|nghị quyết|chỉ thị|quyết định|công văn|kế hoạch|thông báo|luật)\s+(số\s*)?\d{1,4}(\/\d{2,4})?([\/\-][A-Za-zĐđ0-9\-]+)?/gi
  ];
  for (var p = 0; p < patterns.length; p++) {
    var m;
    while ((m = patterns[p].exec(s)) !== null) {
      add(m[0]);
      if (m.index === patterns[p].lastIndex) patterns[p].lastIndex++; // tránh vòng lặp vô hạn với match rỗng
    }
  }
  // Bỏ ref bị chứa trọn trong ref khác dài hơn (giữ dạng đầy đủ "Thông tư 08/2021/..."),
  // tránh trùng lặp kiểu số trần vs có tên loại.
  var keys = order.filter(function (k) {
    for (var i = 0; i < order.length; i++) {
      if (order[i] !== k && order[i].length > k.length && order[i].indexOf(k) !== -1) return false;
    }
    return true;
  });
  return keys.slice(0, ANALYZER_MAX_LEGALREFS).map(function (k) { return found[k]; });
}

/**
 * Nhận diện đối tượng/đơn vị được nhắc tới (dựa danh mục đơn vị ban hành trong Config + đơn vị của VB).
 * normText: nội dung đã chuẩn hoá (không dấu, thường).
 */
function detectEntities_(doc, normText) {
  var out = [], seen = {};
  function push(name) {
    if (!name) return;
    var k = normalizeVi_(name);
    if (k && !seen[k]) { seen[k] = 1; out.push(name); }
  }
  if (doc.issuer) push(doc.issuer);
  var issuers = getIssuers();
  for (var i = 0; i < issuers.length && out.length < ANALYZER_MAX_ENTITIES; i++) {
    var kws = issuers[i].keywords || [];
    for (var j = 0; j < kws.length; j++) {
      if (kws[j] && normText.indexOf(kws[j]) !== -1) { push(issuers[i].name); break; }
    }
  }
  return out.slice(0, ANALYZER_MAX_ENTITIES);
}

/**
 * Suy ra LĨNH VỰC theo từ điển: cụm 2 từ tính điểm cao hơn từ đơn. Trả '' nếu không rõ.
 */
function detectField_(normText) {
  var dict = getFieldDictionary();
  var best = '', bestScore = 0;
  for (var i = 0; i < dict.length; i++) {
    var sc = 0, kws = dict[i].keywords;
    for (var j = 0; j < kws.length; j++) {
      if (normText.indexOf(kws[j]) !== -1) sc += (kws[j].indexOf(' ') !== -1 ? 2 : 1);
    }
    if (sc > bestScore) { bestScore = sc; best = dict[i].field; }
  }
  return best;
}

/**
 * Dựng hồ sơ phân tích cho 1 văn bản. Trả { obj, keyphrases }.
 *   obj        : đối tượng phân tích để lưu (topic/field/concepts/entities/legalRefs)
 *   keyphrases : 3–5 cụm tốt nhất (để lưu cột "Từ khóa")
 */
function buildAnalysis_(doc) {
  var text = (doc.title || '') + ' \n ' + (doc.content || '');
  var normText = normalizeVi_(text);
  var concepts = extractKeyphrases_(text, ANALYZER_MAX_CONCEPTS);
  var keyphrases = concepts.slice(0, ANALYZER_MAX_KEYPHRASES);
  var obj = {
    topic: keyphrases.length ? keyphrases[0].t : String(doc.title || '').substring(0, 80),
    field: detectField_(normText),
    concepts: concepts.map(function (c) { return { t: c.t, n: c.n, w: c.f }; }),
    entities: detectEntities_(doc, normText),
    legalRefs: detectLegalRefs_(text)
  };
  return { obj: obj, keyphrases: keyphrases };
}

/** JSON hoá hồ sơ phân tích để lưu CSDL (an toàn, không ném lỗi ra luồng chính). */
function analysisToString_(o) {
  try { return JSON.stringify(o || {}); } catch (e) { return ''; }
}
/** Đọc hồ sơ phân tích từ chuỗi JSON; luôn trả cấu trúc đầy đủ. */
function parseAnalysis_(str) {
  var empty = { topic: '', field: '', concepts: [], entities: [], legalRefs: [] };
  if (!str) return empty;
  try {
    var o = JSON.parse(str);
    return {
      topic: o.topic || '',
      field: o.field || '',
      concepts: Array.isArray(o.concepts) ? o.concepts : [],
      entities: Array.isArray(o.entities) ? o.entities : [],
      legalRefs: Array.isArray(o.legalRefs) ? o.legalRefs : []
    };
  } catch (e) { return empty; }
}

/**
 * Tính & GẮN hồ sơ phân tích vào văn bản: đặt doc.keywords (3–5) và doc.analysis (JSON).
 * Đây là điểm vào duy nhất được các hook (OCR xong / cập nhật / quét) gọi -> tránh trùng code.
 */
function analyzeAndAttach_(doc) {
  var res = buildAnalysis_(doc);
  doc.keywords = profileToString_(res.keyphrases);
  doc.analysis = analysisToString_(res.obj);
  return doc;
}

/**
 * Văn bản đã phân tích -> chuỗi "để tìm kiếm theo nội dung": key phrases + lĩnh vực +
 * đối tượng + căn cứ pháp lý (đã chuẩn hoá). Giúp Search khớp theo chủ đề, không chỉ substring.
 */
function analysisSearchText_(doc) {
  var a = parseAnalysis_(doc.analysis);
  var parts = [doc.keywords || '', a.field || ''];
  parts.push(a.concepts.map(function (c) { return c.t; }).join(' '));
  parts.push(a.entities.join(' '));
  parts.push(a.legalRefs.join(' '));
  return normalizeVi_(parts.join(' \n '));
}

/* ===================== TÀI LIỆU LIÊN QUAN (ĐA YẾU TỐ) ===================== */

/**
 * Đọc "nhẹ" các cột cần cho tính liên quan (gồm cột Phân tích), KHÔNG đọc nội dung nặng.
 */
function readRelatedDocs_() {
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var n = lastRow - 1;
  var a = sheet.getRange(2, 1, n, COLS.TITLE + 1).getValues();
  var b = sheet.getRange(2, COLS.ISSUER + 1, n, COLS.ANALYSIS - COLS.ISSUER + 1).getValues();
  var kOff = COLS.KEYWORDS - COLS.ISSUER;
  var aOff = COLS.ANALYSIS - COLS.ISSUER;
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
      keywords: cell_(b[i][kOff]),
      analysis: cell_(b[i][aOff])
    });
  }
  return out;
}

/** Tập token tiêu đề (chuẩn hoá, bỏ từ dừng, >=3 ký tự). */
function titleTermSet_(title) {
  var set = {};
  tokenizeVi_(title).forEach(function (t) {
    if (t.n.length >= 3 && !isStopword_(t.n) && !/^\d+$/.test(t.n)) set[t.n] = 1;
  });
  return set;
}

/**
 * Tìm 5–10 tài liệu liên quan nhất tới fileId, kết hợp nhiều yếu tố.
 */
function getRelatedDocs_(fileId, limit) {
  limit = Math.min(Math.max(limit || 8, 5), 10);
  var docs = readRelatedDocs_();
  var N = docs.length;
  if (N < 2) return [];

  var W = getRelatedWeights();

  // Chuẩn bị tín hiệu cho từng văn bản.
  var sig = docs.map(function (d) {
    var a = parseAnalysis_(d.analysis);
    var terms = a.concepts.length
      ? a.concepts.map(function (c) { return { n: c.n, w: c.w || 1 }; })
      : parseProfile_(d.keywords).map(function (x) { return { n: x.n, w: x.f }; });
    var legalSet = {};
    a.legalRefs.forEach(function (x) { var k = normalizeVi_(x); if (k) legalSet[k] = 1; });
    return { terms: terms, field: a.field, legal: legalSet, titleTerms: titleTermSet_(d.title) };
  });

  // Document frequency + IDF trên khái niệm.
  var df = {};
  for (var i = 0; i < N; i++) {
    var seen = {};
    for (var j = 0; j < sig[i].terms.length; j++) {
      var t = sig[i].terms[j].n;
      if (!seen[t]) { seen[t] = 1; df[t] = (df[t] || 0) + 1; }
    }
  }
  function idf(t) { return Math.log(1 + N / ((df[t] || 0) + 0.5)); }
  function vec(terms) {
    var v = {}, norm2 = 0;
    for (var k = 0; k < terms.length; k++) {
      var w = (1 + Math.log(terms[k].w > 0 ? terms[k].w : 1)) * idf(terms[k].n);
      v[terms[k].n] = w; norm2 += w * w;
    }
    return { v: v, len: Math.sqrt(norm2) || 1 };
  }

  var ti = -1;
  for (var x = 0; x < N; x++) if (docs[x].fileId === fileId) { ti = x; break; }
  if (ti === -1) return [];
  var target = docs[ti], tsig = sig[ti];
  var tv = vec(tsig.terms);
  var tYear = (target.issuedDate || '').substring(0, 4);
  var tKeys = Object.keys(tv.v);

  var scored = [];
  for (var m = 0; m < N; m++) {
    if (m === ti) continue;
    var d = docs[m], s = sig[m];
    var ov = vec(s.terms);

    // (1) Nội dung: cosine trên khái niệm.
    var dot = 0, shared = 0;
    for (var y = 0; y < tKeys.length; y++) {
      var tk = tKeys[y];
      if (ov.v[tk]) { dot += tv.v[tk] * ov.v[tk]; shared++; }
    }
    var cosine = dot / (tv.len * ov.len);
    var score = cosine * W.cosine;

    // (2) Căn cứ pháp lý dùng chung (tín hiệu mạnh).
    var sharedRefs = 0;
    for (var lk in tsig.legal) { if (s.legal[lk]) sharedRefs++; }
    if (sharedRefs) score += Math.min(sharedRefs, W.legalRefCap) * W.legalRef;

    // (3) Cùng lĩnh vực.
    if (s.field && s.field === tsig.field) score += W.field;

    // (4) Trùng từ khoá tiêu đề.
    var tt = 0;
    for (var tw in tsig.titleTerms) { if (s.titleTerms[tw]) tt++; }
    if (tt) score += Math.min(tt, W.titleTermCap) * W.titleTerm;

    // (5) Danh mục / metadata.
    if (d.docTypeCode && d.docTypeCode === target.docTypeCode) score += W.sameType;
    if (d.issuer && d.issuer === target.issuer) score += W.sameIssuer;
    else if (d.issuerLevel && d.issuerLevel === target.issuerLevel) score += W.sameLevel;
    if (tYear && (d.issuedDate || '').substring(0, 4) === tYear) score += W.sameYear;

    if (score >= W.threshold) {
      scored.push({
        fileId: d.fileId, title: d.title, fileName: d.fileName, docType: d.docType,
        docNumber: d.docNumber, issuedDate: d.issuedDate, issuer: d.issuer,
        field: s.field, shared: shared, sharedRefs: sharedRefs,
        similarity: Math.round(cosine * 100), score: Math.round(score)
      });
    }
  }
  scored.sort(function (a, b) { return b.score - a.score; });
  return scored.slice(0, limit);
}
