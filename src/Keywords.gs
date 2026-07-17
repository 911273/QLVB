/**
 * Keywords.gs
 * Tầng TỪ VỰNG: tách token, lọc từ dừng, và trích KEY PHRASES chất lượng bằng RAKE
 * (Rapid Automatic Keyword Extraction) — chọn cụm theo điểm degree/freq, ưu tiên cụm
 * danh từ/thuật ngữ, khử trùng lặp/gần giống, KHÔNG thuần theo tần suất.
 *
 * Cột "Từ khóa" lưu 3–5 key phrase dạng: "khoa hoc cong nghe|9, quy che dao tao|7, ..."
 * (cụm hiển thị | trọng số). Phân tích nội dung & tài liệu liên quan nằm ở Analyzer.gs.
 */

var VI_STOPWORDS = {
  'cua': 1, 'va': 1, 'cac': 1, 'cho': 1, 'duoc': 1, 'trong': 1, 'la': 1, 'co': 1, 'mot': 1,
  'nhung': 1, 'de': 1, 'voi': 1, 'theo': 1, 'khi': 1, 'nay': 1, 'da': 1, 'tai': 1, 've': 1,
  'tu': 1, 'den': 1, 'cung': 1, 'nhu': 1, 'sau': 1, 'truoc': 1, 'do': 1, 'boi': 1, 'hoac': 1,
  'neu': 1, 'thi': 1, 'ma': 1, 'ra': 1, 'vao': 1, 'len': 1, 'xuong': 1, 'hon': 1, 'rat': 1,
  'se': 1, 'dang': 1, 'bi': 1, 'phai': 1, 'con': 1, 'nen': 1, 'tren': 1, 'duoi': 1, 'giua': 1,
  'ngoai': 1, 'cai': 1, 'nao': 1, 'gi': 1, 'ai': 1, 'dau': 1, 'sao': 1, 'the': 1, 'vi': 1,
  'nham': 1, 'qua': 1, 'lai': 1, 'nua': 1, 'chi': 1, 'chua': 1, 'hay': 1, 'tuy': 1, 'tuc': 1,
  'so': 1, 'ngay': 1, 'thang': 1, 'nam': 1, 'viec': 1, 'kem': 1, 'gom': 1, 'moi': 1, 'toan': 1,
  'thuc hien': 0
};
function isStopword_(nw) { return VI_STOPWORDS[nw] === 1; }

/**
 * Tách văn bản thành danh sách token {d: hiển thị (thường), n: chuẩn hoá không dấu}.
 */
function tokenizeVi_(text) {
  var raw = String(text || '').substring(0, ANALYSIS_TEXT_LIMIT).toLowerCase();
  var words = raw.replace(/[^0-9a-zà-ỹ\s]/gi, ' ').split(/\s+/).filter(Boolean);
  return words.map(function (w) { return { d: w, n: normalizeVi_(w) }; });
}

/**
 * Trích KEY PHRASES bằng RAKE.
 *  - Cắt văn bản thành cụm ứng viên tại các từ dừng / số / token quá ngắn.
 *  - Điểm mỗi từ = degree/freq (degree = tổng bậc đồng xuất hiện trong cụm).
 *  - Điểm cụm = tổng điểm từ; ưu tiên cụm nhiều từ (danh từ ghép) và cụm lặp lại.
 *  - Khử trùng lặp/gần giống (bao hàm token hoặc trùng >= 60%).
 * Trả mảng {t: hiển thị, n: chuẩn hoá, f: trọng số nguyên} đã xếp theo điểm giảm dần.
 */
function extractKeyphrases_(text, maxN) {
  maxN = maxN || ANALYZER_MAX_KEYPHRASES;
  var raw = String(text || '').substring(0, ANALYSIS_TEXT_LIMIT).toLowerCase();
  if (!raw.trim()) return [];

  var maxLen = ANALYZER_MAX_PHRASE_WORDS;

  // (1) Cắt thành ĐOẠN ứng viên: trước hết theo dấu câu (ranh giới câu/cụm), rồi theo
  //     từ dừng / số / token quá ngắn — KHÔNG để cụm bắc qua dấu câu hay từ dừng.
  var segs = [], cur = [];
  function isBoundary(t) { return isStopword_(t.n) || t.n.length < 2 || /^\d+$/.test(t.n); }
  function flushSeg() { if (cur.length) { segs.push(cur); cur = []; } }
  var chunks = raw.split(/[^0-9a-zà-ỹ\s]+/); // tách tại dấu câu / ký tự đặc biệt
  for (var ci = 0; ci < chunks.length; ci++) {
    var words = chunks[ci].split(/\s+/).filter(Boolean);
    for (var wi = 0; wi < words.length; wi++) {
      var t = { d: words[wi], n: normalizeVi_(words[wi]) };
      if (isBoundary(t)) flushSeg();
      else cur.push(t);
    }
    flushSeg(); // hết một chunk -> đóng đoạn (không bắc qua dấu câu)
  }
  if (!segs.length) return [];

  // (2) RAKE: freq & degree cho từng từ dựa trên đồng xuất hiện trong đoạn.
  var freq = {}, degree = {};
  for (var p = 0; p < segs.length; p++) {
    var deg = segs[p].length;
    for (var w = 0; w < segs[p].length; w++) {
      var n = segs[p][w].n;
      freq[n] = (freq[n] || 0) + 1;
      degree[n] = (degree[n] || 0) + deg;
    }
  }
  function wscore(n) { return degree[n] / freq[n]; }

  // (3) Sinh cụm ứng viên (n-gram dài 1..maxLen trong mỗi đoạn), gộp trùng, tính điểm.
  var byKey = {}, cand = [];
  for (var s = 0; s < segs.length; s++) {
    var seg = segs[s];
    for (var L = 1; L <= maxLen; L++) {
      for (var st = 0; st + L <= seg.length; st++) {
        var g = seg.slice(st, st + L);
        var nkey = g.map(function (x) { return x.n; }).join(' ');
        if (byKey[nkey]) { byKey[nkey].occ++; continue; }
        var disp = g.map(function (x) { return x.d; }).join(' ');
        var base = 0;
        for (var r = 0; r < g.length; r++) base += wscore(g[r].n);
        byKey[nkey] = { t: disp, n: nkey, len: L, base: base, occ: 1 };
        cand.push(byKey[nkey]);
      }
    }
  }
  // Điểm cuối: điểm RAKE * thưởng cụm nhiều từ * hệ số lần xuất hiện (không thuần tần suất).
  cand.forEach(function (c) {
    var mult = (c.len > 1 ? 1.4 : 1) * (1 + Math.log(c.occ));
    c.score = c.base * mult;
  });
  cand.sort(function (a, b) { return b.score - a.score; });

  // Khử trùng lặp/gần giống, giữ tối đa maxN.
  var kept = [];
  for (var k = 0; k < cand.length && kept.length < maxN; k++) {
    var c2 = cand[k];
    var dup = false;
    for (var j = 0; j < kept.length; j++) {
      if (phrasesNearDuplicate_(c2.n, kept[j].n)) { dup = true; break; }
    }
    if (!dup) kept.push(c2);
  }
  return kept.map(function (c) { return { t: c.t, n: c.n, f: Math.max(1, Math.round(c.score)) }; });
}

/**
 * Hai cụm coi là "gần trùng" nếu một cụm chứa trọn cụm kia (theo token), hoặc trùng >= 60% token.
 */
function phrasesNearDuplicate_(a, b) {
  if (a === b) return true;
  var ta = a.split(' '), tb = b.split(' ');
  var setB = {}; tb.forEach(function (w) { setB[w] = 1; });
  var inter = 0; ta.forEach(function (w) { if (setB[w]) inter++; });
  if (inter === ta.length || inter === tb.length) return true; // bao hàm
  var uni = ta.length + tb.length - inter;
  return uni > 0 && (inter / uni) >= 0.6;
}

/** Chuỗi lưu CSDL từ hồ sơ cụm. */
function profileToString_(profile) {
  return profile.map(function (x) { return x.t + '|' + x.f; }).join(', ');
}
/** Đọc chuỗi "cụm|trọng số, ..." thành mảng {t, n, f}. */
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

/**
 * Chuỗi 3–5 key phrase để lưu cột "Từ khóa" (từ tiêu đề + nội dung).
 * Giữ tên hàm cũ để các nơi đang gọi không phải đổi.
 */
function computeKeywords_(text) {
  return profileToString_(extractKeyphrases_(text, ANALYZER_MAX_KEYPHRASES));
}
