// Xử lý thời khóa biểu EPU: đọc từ Excel -> danh sách buổi học -> xuất
// CSV (Google Calendar) / ICS. Port từ script Python tkb_timetable_to_csv.py,
// giữ nguyên quy tắc cột, giờ tiết và cách suy ra tuần/thứ.

// Giờ bắt đầu / kết thúc theo tiết (cố định của trường).
export const START_TIMES = {
  1: '07:00', 2: '07:55', 3: '08:50', 4: '09:50',
  5: '10:45', 6: '12:30', 7: '13:25', 8: '14:20',
  9: '15:20', 10: '16:15', 11: '17:30', 12: '18:25',
  13: '19:20', 14: '20:15',
};
export const END_TIMES = {
  1: '07:50', 2: '08:45', 3: '09:40', 4: '10:40',
  5: '11:35', 6: '13:20', 7: '14:15', 8: '15:10',
  9: '16:10', 10: '17:05', 11: '18:20', 12: '19:15',
  13: '20:10', 14: '21:05',
};

// Chỉ số cột (0-based) trong sheet — khớp file TKB của trường.
const COL = { CLASS: 3, COURSE: 4, DAY: 6, P1: 7, P2: 8, ROOM: 10, WEEK: 11 };

function trimSafe(s) {
  if (s === null || s === undefined) return '';
  return String(s).replace(/\s+/g, ' ').trim();
}

function isEmptyLike(s) {
  const t = trimSafe(s).toUpperCase();
  return t === '' || t === 'NAN' || t === 'NONE';
}

/** Lấy số nguyên đầu tiên; CN -> 8; rỗng -> null. */
function parseIntOrNull(s) {
  const t = trimSafe(s).toUpperCase();
  if (['', 'NAN', 'NA', 'NONE'].includes(t)) return null;
  if (['CN', 'CHỦ NHẬT', 'CHU NHAT'].includes(t)) return 8;
  const m = t.match(/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Suy ra danh sách tuần từ ô "Tuần học".
 * - Có ',' hoặc ';'  -> danh sách/range (vd "1,2,5-7").
 * - Ngược lại        -> theo vị trí: mỗi ký tự = 1 tuần, chữ số = có học.
 */
export function parseWeekList(s) {
  if (s === null || s === undefined) return [];
  let t = String(s).replace(/[\r\n]/g, '').trim();

  if (t.includes(',') || t.includes(';')) {
    const t2 = t.replace(/;/g, ',').replace(/ /g, '');
    const parts = t2.split(',').filter(Boolean);
    const weeks = [];
    for (const part of parts) {
      if (part.includes('-') && (part.match(/-/g) || []).length === 1) {
        let [a, b] = part.split('-');
        if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
          let ai = parseInt(a, 10), bi = parseInt(b, 10);
          if (ai > bi) [ai, bi] = [bi, ai];
          for (let w = ai; w <= bi; w++) weeks.push(w);
        }
      } else if (/^\d+$/.test(part)) {
        weeks.push(parseInt(part, 10));
      }
    }
    if (weeks.length) return weeks;
    t = t.replace(/,/g, '').replace(/;/g, '');
  }

  // Range thuần "n-m" (vd "1-16") -> tuần n..m. Xét trước parser theo vị trí,
  // vì chuỗi vị trí luôn có nhiều dấu '-' (vd "-2---...") nên không trùng mẫu này.
  const range = t.match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    let a = parseInt(range[1], 10), b = parseInt(range[2], 10);
    if (a > b) [a, b] = [b, a];
    const out = [];
    for (let w = a; w <= b; w++) out.push(w);
    return out;
  }

  const weeks2 = [];
  let weekIdx = 0;
  for (const ch of t) {
    if (ch === ' ') continue;
    weekIdx += 1;
    if (ch >= '0' && ch <= '9') weeks2.push(weekIdx);
  }
  if (weeks2.length) return weeks2;

  if (/^\d+$/.test(t)) return [parseInt(t, 10)];
  return [];
}

/** Ngày học = từ Thứ 2 tuần 1 (baseMonday) + theo tuần & thứ. */
export function dateFromWeekThu(baseMonday, w, thu) {
  let offset;
  if (thu >= 2 && thu <= 7) offset = (w - 1) * 7 + (thu - 2);
  else if (thu === 8) offset = (w - 1) * 7 + 6;
  else offset = (w - 1) * 7;
  const d = new Date(baseMonday.getTime());
  d.setDate(d.getDate() + offset);
  return d;
}

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const DOW_LABEL = { 2: 'Thứ 2', 3: 'Thứ 3', 4: 'Thứ 4', 5: 'Thứ 5', 6: 'Thứ 6', 7: 'Thứ 7', 8: 'CN' };

/**
 * Chuyển các dòng sheet (mảng mảng) thành danh sách buổi học đã trải theo tuần.
 * @param {any[][]} rows dữ liệu sheet dạng mảng-các-mảng (header:1).
 * @param {Date} baseMonday Thứ 2 của tuần 1 (đã cộng offset).
 * @returns {Array<Object>} mỗi phần tử là 1 buổi học cụ thể.
 */
export function buildSessions(rows, baseMonday) {
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    const wRaw = row[COL.WEEK], thuRaw = row[COL.DAY], p1Raw = row[COL.P1], p2Raw = row[COL.P2];
    const clazz = row[COL.CLASS], course = row[COL.COURSE], room = row[COL.ROOM];
    if ([wRaw, thuRaw, p1Raw, p2Raw, clazz, course, room].every(isEmptyLike)) continue;

    const weeks = parseWeekList(wRaw);
    const thu = parseIntOrNull(thuRaw);
    let p1 = parseIntOrNull(p1Raw);
    let p2 = parseIntOrNull(p2Raw);
    if (!weeks.length || thu === null || p1 === null || p2 === null) continue;
    if (p2 < p1) [p1, p2] = [p2, p1];
    if (!(p1 in START_TIMES) || !(p2 in END_TIMES)) continue;

    let subject = trimSafe(clazz);
    if (subject && trimSafe(course)) subject = `${subject} - ${trimSafe(course)}`;
    else if (!subject) subject = trimSafe(course);

    for (const w of weeks) {
      const date = dateFromWeekThu(baseMonday, Number(w), Number(thu));
      out.push({
        week: Number(w),
        thu: Number(thu),
        thuLabel: DOW_LABEL[thu] || String(thu),
        p1, p2,
        date: ymd(date),
        startTime: START_TIMES[p1],
        endTime: END_TIMES[p2],
        subject,
        class: trimSafe(clazz),
        course: trimSafe(course),
        room: trimSafe(room),
      });
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.p1 - b.p1 : a.date < b.date ? -1 : 1));
  return out;
}

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

/** Xuất CSV chuẩn Google Calendar (UTF-8 BOM). */
export function buildGcalCsv(sessions) {
  const header = ['Subject', 'Start Date', 'Start Time', 'End Date', 'End Time', 'Location'];
  const lines = [header.map(csvEscape).join(',')];
  for (const s of sessions) {
    lines.push([s.subject, s.date, s.startTime, s.date, s.endTime, s.room].map(csvEscape).join(','));
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function icsDt(dateStr, timeStr) {
  return dateStr.replace(/-/g, '') + 'T' + timeStr.replace(':', '') + '00';
}
function icsEscape(v) {
  return String(v == null ? '' : v).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

/** Xuất ICS (mỗi buổi 1 VEVENT, giờ địa phương). */
export function buildIcs(sessions) {
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//vupq-hub//TKB//VI', 'CALSCALE:GREGORIAN',
  ];
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  sessions.forEach((s, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:tkb-${i}-${s.date}-${s.p1}@vupq-hub`,
      `DTSTAMP:${stamp}`,
      `DTSTART:${icsDt(s.date, s.startTime)}`,
      `DTEND:${icsDt(s.date, s.endTime)}`,
      `SUMMARY:${icsEscape(s.subject)}`,
      `LOCATION:${icsEscape(s.room)}`,
      'END:VEVENT'
    );
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
