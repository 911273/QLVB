/**
 * Export.gs
 * Xuất danh mục văn bản ra CSV (mở được bằng Excel) theo đúng bộ lọc đang tìm kiếm.
 */

function csvCell_(v) {
  v = (v == null) ? '' : String(v);
  if (/[",\r\n]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
  return v;
}
function csvDate_(iso) {
  if (!iso) return '';
  var p = String(iso).substring(0, 10).split('-');
  return (p.length === 3) ? (p[2] + '/' + p[1] + '/' + p[0]) : String(iso);
}

/**
 * Trả về { csv, count, filename } cho danh mục văn bản khớp bộ lọc.
 */
function exportDocsCsv_(query) {
  query = query || {};
  query.page = 1;
  query.pageSize = 100000; // lấy tất cả kết quả khớp
  var res = searchDocs(query);

  var headers = ['STT', 'Số/Ký hiệu', 'Loại văn bản', 'Trích yếu', 'Ngày ban hành',
    'Đơn vị ban hành', 'Cấp ban hành', 'Trạng thái', 'Độ mật', 'Độ khẩn', 'Tên file', 'Link Drive'];
  var lines = [headers.map(csvCell_).join(',')];
  res.items.forEach(function (d, i) {
    var row = [
      i + 1, d.docNumber, d.docType, d.title, csvDate_(d.issuedDate),
      d.issuer, d.issuerLevel, d.status, d.security, d.urgency, d.fileName, d.fileUrl
    ];
    lines.push(row.map(csvCell_).join(','));
  });

  return {
    csv: lines.join('\r\n'),
    count: res.items.length,
    filename: 'DanhMucVanBan_' + Utilities.formatDate(new Date(), 'Asia/Ho_Chi_Minh', 'yyyyMMdd_HHmm') + '.csv'
  };
}
