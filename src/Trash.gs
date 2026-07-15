/**
 * Trash.gs
 * Thùng rác trong app: xoá văn bản sẽ chuyển sang sheet "ThungRac" (kèm file Drive vào
 * Thùng rác Drive), có thể khôi phục hoặc xoá vĩnh viễn.
 */

var TRASH_SHEET = 'ThungRac';

function getTrashSheet_() {
  var ss = getOrCreateDatabase();
  var sh = ss.getSheetByName(TRASH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(TRASH_SHEET);
    var headers = DB_HEADERS.concat(['Xoá lúc', 'Người xoá']);
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, headers.length).setFontWeight('bold')
      .setBackground('#8B0000').setFontColor('#ffffff');
  }
  return sh;
}

/**
 * Xoá văn bản -> đưa vào thùng rác (giữ nguyên bản ghi để khôi phục) + chuyển file Drive vào Thùng rác.
 */
function deleteDocToTrash_(fileId, byEmail) {
  if (!fileId) throw new Error('Thiếu mã văn bản.');
  var sheet = getDocsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) throw new Error('Không có dữ liệu.');
  var ids = sheet.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  var rowIndex = -1;
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(fileId)) { rowIndex = i + 2; break; }
  }
  if (rowIndex === -1) throw new Error('Không tìm thấy văn bản trong danh sách.');

  var rowVals = sheet.getRange(rowIndex, 1, 1, DB_HEADERS.length).getValues()[0];
  // Ghi vào thùng rác
  var trash = getTrashSheet_();
  trash.appendRow(rowVals.concat([new Date(), byEmail || '']));
  // Xoá khỏi danh sách chính
  sheet.deleteRow(rowIndex);
  // Đưa file vào Thùng rác Drive
  var trashed = false;
  try { DriveApp.getFileById(fileId).setTrashed(true); trashed = true; } catch (e) {}
  writeLog_('Xoá vào thùng rác', 1, (rowVals[COLS.FILE_NAME] || fileId));
  return { ok: true, trashed: trashed };
}

/**
 * Danh sách văn bản trong thùng rác.
 */
function listTrash_() {
  var trash = getTrashSheet_();
  var lastRow = trash.getLastRow();
  if (lastRow < 2) return [];
  var w = DB_HEADERS.length + 2;
  var vals = trash.getRange(2, 1, lastRow - 1, w).getValues();
  return vals.map(function (r) {
    var d = rowToObj_(r);
    d.deletedAt = cell_(r[DB_HEADERS.length]);
    d.deletedBy = cell_(r[DB_HEADERS.length + 1]);
    return d;
  }).reverse(); // mới xoá lên đầu
}

function findTrashRow_(trash, fileId) {
  var lastRow = trash.getLastRow();
  if (lastRow < 2) return -1;
  var ids = trash.getRange(2, COLS.FILE_ID + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(fileId)) return i + 2;
  }
  return -1;
}

/**
 * Khôi phục 1 văn bản từ thùng rác về danh sách + phục hồi file Drive.
 */
function restoreDoc_(fileId) {
  var trash = getTrashSheet_();
  var row = findTrashRow_(trash, fileId);
  if (row === -1) throw new Error('Không tìm thấy trong thùng rác.');
  var rowVals = trash.getRange(row, 1, 1, DB_HEADERS.length).getValues()[0];
  // Phục hồi file Drive
  try { DriveApp.getFileById(fileId).setTrashed(false); } catch (e) {}
  // Đưa lại vào danh sách chính (nếu chưa có)
  var sheet = getDocsSheet_();
  var existing = getExistingIndex_();
  if (!existing[fileId]) sheet.appendRow(rowVals);
  trash.deleteRow(row);
  writeLog_('Khôi phục văn bản', 1, (rowVals[COLS.FILE_NAME] || fileId));
  return { ok: true };
}

/**
 * Xoá vĩnh viễn 1 văn bản khỏi thùng rác (bản ghi). File vẫn ở Thùng rác Drive (Drive tự dọn sau ~30 ngày).
 */
function purgeDoc_(fileId) {
  var trash = getTrashSheet_();
  var row = findTrashRow_(trash, fileId);
  if (row === -1) throw new Error('Không tìm thấy trong thùng rác.');
  trash.deleteRow(row);
  writeLog_('Xoá vĩnh viễn', 1, fileId);
  return { ok: true };
}

function emptyTrash_() {
  var trash = getTrashSheet_();
  var lastRow = trash.getLastRow();
  var count = Math.max(0, lastRow - 1);
  if (lastRow > 1) trash.deleteRows(2, lastRow - 1);
  writeLog_('Dọn sạch thùng rác', count, '');
  return { ok: true, removed: count };
}

function trashCount_() {
  try { return Math.max(0, getTrashSheet_().getLastRow() - 1); } catch (e) { return 0; }
}
