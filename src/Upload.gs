/**
 * Upload.gs
 * Tải file lên trực tiếp trong app: lưu vào folder gốc trên Drive rồi lập chỉ mục ngay
 * (ảnh/PDF sẽ được xếp hàng đợi OCR như khi quét).
 */

function uploadFile_(p, acc) {
  if (!p || !p.dataBase64 || !p.name) throw new Error('Thiếu dữ liệu file.');
  var bytes = Utilities.base64Decode(p.dataBase64);
  var blob = Utilities.newBlob(bytes, p.mimeType || 'application/octet-stream', p.name);

  var folder = getOrCreateRootFolder();
  var file = folder.createFile(blob);

  var existing = getExistingIndex_();
  var f = {
    id: file.getId(),
    name: file.getName(),
    mimeType: file.getMimeType(),
    url: file.getUrl(),
    modifiedTime: file.getLastUpdated().getTime(),
    createdDate: file.getDateCreated(),
    folderPath: '/'
  };
  var doc = processFile_(f, existing);
  refreshDuplicateCount_(); // cập nhật số nghi trùng

  return {
    ok: true,
    fileId: doc.fileId,
    fileName: doc.fileName,
    docType: doc.docType,
    docTypeCode: doc.docTypeCode,
    docNumber: doc.docNumber,
    ocrStatus: doc.ocrStatus
  };
}
