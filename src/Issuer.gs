/**
 * Issuer.gs
 * Nhận diện ĐƠN VỊ BAN HÀNH + CẤP BAN HÀNH từ tên file và nội dung văn bản.
 *
 * Văn bản hành chính thường ghi cơ quan cấp trên rồi tới đơn vị ban hành, ví dụ:
 *   "BỘ CÔNG THƯƠNG / TRƯỜNG ĐẠI HỌC ĐIỆN LỰC".
 * Vì vậy khi nhiều cấp cùng xuất hiện, ta chọn đơn vị ở CẤP CỤ THỂ NHẤT (rank cao nhất).
 */
function detectIssuer_(fileName, content) {
  var hay = normalizeVi_((content || '').substring(0, 2500) + ' \n ' + (fileName || ''));
  var issuers = getIssuers();

  var best = null;   // {name, level, rank}
  for (var i = 0; i < issuers.length; i++) {
    var it = issuers[i];
    if (matchKeywords_(hay, it.keywords)) {
      var rank = getLevelRank_(it.level);
      if (!best || rank > best.rank) {
        best = { name: it.name, level: it.level, rank: rank };
      }
    }
  }
  if (best) return { name: best.name, level: best.level };
  return { name: '', level: '' };
}
