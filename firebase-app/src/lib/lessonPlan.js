// Kế hoạch giảng dạy: đọc từ Excel (Môn, Loại LT/TH, Nội dung, Số tiết) và gán
// nội dung bài học vào từng buổi trong TKB theo số tiết cộng dồn.

function norm(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

// Rút gọn nội dung để hiển thị ở tiêu đề (cắt trước tiểu mục "x.y" đầu tiên).
export function lessonShort(lesson) {
  if (!lesson) return '';
  const i = lesson.search(/\d+\.\d/);
  const head = i > 0 ? lesson.slice(0, i) : lesson;
  return head.trim().replace(/\s+/g, ' ').slice(0, 80);
}

// Buổi thực hành nhận theo tên phòng (TKB dùng "_TH"/"_THTin" cho phòng thực hành).
function roomIsTH(room) {
  return /_th|thực\s*hành|thí\s*nghiệm/i.test(String(room || ''));
}

/**
 * Đọc bảng kế hoạch (mảng-các-mảng từ Excel) -> gom theo Môn + loại LT/TH.
 * @param {any[][]} aoa dữ liệu sheet (header:1).
 * @returns {Object} { [normMôn]: { name, LT:[{content,periods}], TH:[...] } }
 */
export function parsePlan(aoa) {
  let h = -1, col = {};
  for (let i = 0; i < Math.min(aoa.length, 12); i++) {
    const r = (aoa[i] || []).map((x) => norm(x));
    const mon = r.findIndex((x) => x.includes('môn') || x === 'mon' || x.includes('mon'));
    const nd = r.findIndex((x) => x.includes('nội dung') || x.includes('noi dung'));
    const st = r.findIndex((x) => x.includes('số tiết') || x.includes('so tiet') || x.includes('tiết'));
    if (mon >= 0 && nd >= 0 && st >= 0) {
      const loai = r.findIndex((x) => x.includes('loại') || x.includes('loai'));
      h = i; col = { mon, nd, st, loai }; break;
    }
  }
  if (h < 0) return {};
  const byCourse = {};
  for (let i = h + 1; i < aoa.length; i++) {
    const r = aoa[i] || [];
    const mon = String(r[col.mon] == null ? '' : r[col.mon]).trim();
    const nd = String(r[col.nd] == null ? '' : r[col.nd]).trim();
    const periods = parseInt(String(r[col.st] == null ? '' : r[col.st]).replace(/[^\d]/g, ''), 10);
    if (!mon || !nd || !periods) continue;
    const loai = col.loai >= 0 && String(r[col.loai] || '').toUpperCase().includes('TH') ? 'TH' : 'LT';
    const key = norm(mon);
    if (!byCourse[key]) byCourse[key] = { name: mon, LT: [], TH: [] };
    byCourse[key][loai].push({ content: nd, periods });
  }
  return byCourse;
}

function findCourse(byCourse, courseName) {
  const c = norm(courseName);
  if (!c) return null;
  if (byCourse[c]) return byCourse[c];
  for (const k in byCourse) {
    if (k.includes(c) || c.includes(k)) return byCourse[k];
  }
  return null;
}

// Gán tuần tự nội dung theo số tiết cộng dồn cho danh sách buổi (đã sắp theo ngày).
function consume(sessList, items) {
  const arr = sessList.slice().sort((a, b) => (a.date === b.date ? a.p1 - b.p1 : a.date < b.date ? -1 : 1));
  let idx = 0, used = 0;
  for (const s of arr) {
    let need = s.p2 - s.p1 + 1;
    const cov = [];
    while (need > 0 && idx < items.length) {
      const it = items[idx];
      const take = Math.min(need, it.periods - used);
      cov.push(it.content);
      used += take; need -= take;
      if (used >= it.periods) { idx++; used = 0; }
    }
    const uniq = [...new Set(cov)];
    if (uniq.length) {
      s.lesson = uniq.join(' + ');
      s.lessonShort = uniq.map(lessonShort).join(' + ');
    }
  }
}

/**
 * Gán nội dung bài học cho các buổi dựa trên kế hoạch giảng dạy.
 * @param {Array} sessions buổi học (có course, room, date, p1, p2).
 * @param {Object} byCourse kết quả parsePlan.
 * @returns {Array} bản sao buổi học kèm lesson/lessonShort.
 */
export function assignLessons(sessions, byCourse) {
  const result = sessions.map((s) => ({ ...s }));
  const groups = {};
  for (const s of result) (groups[s.course] = groups[s.course] || []).push(s);
  for (const course in groups) {
    const plan = findCourse(byCourse, course);
    if (!plan) continue;
    const sess = groups[course];
    const hasLT = plan.LT.length > 0, hasTH = plan.TH.length > 0;
    if (hasLT && hasTH) {
      consume(sess.filter((x) => !roomIsTH(x.room)), plan.LT);
      consume(sess.filter((x) => roomIsTH(x.room)), plan.TH);
    } else if (hasTH) {
      consume(sess, plan.TH);
    } else {
      consume(sess, plan.LT);
    }
  }
  return result;
}
