// Logic trộn đề trắc nghiệm & chấm điểm — theo nguyên lý phần mềm Midx (desktop),
// thích ứng cho web: câu hỏi có cấu trúc, sinh nhiều mã đề, chấm theo mã đề.

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

/** Trộn mảng (Fisher–Yates), không đổi mảng gốc. */
export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Phân tích câu hỏi từ văn bản dán hàng loạt.
 * Định dạng mỗi câu (cách nhau bằng dòng trống):
 *   Nội dung câu hỏi...
 *   *A. Đáp án đúng   (dấu * ở đầu = đáp án đúng)
 *   B. Đáp án
 *   C. ...
 * @returns {{questions:Array, errors:string[]}}
 */
export function parseQuestions(text) {
  const blocks = String(text || '')
    .replace(/\r/g, '')
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  const questions = [];
  const errors = [];

  blocks.forEach((block, bi) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) {
      errors.push(`Câu ${bi + 1}: cần ít nhất 1 dòng đề + 2 đáp án.`);
      return;
    }
    const optRe = /^(\*?)\s*([A-Ha-h])[.)]\s*(.+)$/;
    let firstOpt = lines.findIndex((l) => optRe.test(l));
    if (firstOpt < 1) {
      errors.push(`Câu ${bi + 1}: không nhận ra dòng đáp án (dạng "A. ...").`);
      return;
    }
    const stem = lines.slice(0, firstOpt).join(' ').trim();
    const options = [];
    for (let i = firstOpt; i < lines.length; i++) {
      const m = lines[i].match(optRe);
      if (!m) { options[options.length - 1] && (options[options.length - 1].text += ' ' + lines[i]); continue; }
      options.push({ text: m[3].trim(), correct: m[1] === '*' });
    }
    if (options.length < 2) { errors.push(`Câu ${bi + 1}: cần ít nhất 2 đáp án.`); return; }
    if (!options.some((o) => o.correct)) { errors.push(`Câu ${bi + 1}: chưa đánh dấu đáp án đúng (thêm * trước đáp án).`); return; }
    questions.push({ id: 'q' + Date.now() + '_' + bi, stem, options, diff: '', chapter: '' });
  });

  return { questions, errors };
}

/**
 * Sinh danh sách mã đề. Mỗi mã đề: trộn thứ tự câu + (tùy chọn) trộn đáp án,
 * ghi lại đáp án đúng theo vị trí (giống bảng variant_questions của Midx).
 * @param {Array} questions ngân hàng câu hỏi.
 * @param {{numQuestions?:number,numVariants:number,shuffleAnswers:boolean,startCode?:number}} opts
 * @returns {Array<{code:number, items:Array, key:string[]}>}
 */
export function makeVariants(questions, opts) {
  const { numQuestions, numVariants, shuffleAnswers, startCode = 101 } = opts;
  const variants = [];
  const take = numQuestions && numQuestions > 0 ? numQuestions : questions.length;

  for (let v = 0; v < numVariants; v++) {
    const code = startCode + v;
    const qs = shuffle(questions).slice(0, take);
    const items = qs.map((q, idx) => {
      let opts = q.options.map((o) => ({ ...o }));
      if (shuffleAnswers) opts = shuffle(opts);
      const correctPos = opts.findIndex((o) => o.correct);
      return {
        position: idx + 1,
        stem: q.stem,
        options: opts.map((o) => o.text),
        correctLabel: LABELS[correctPos] || '',
      };
    });
    variants.push({ code, items, key: items.map((it) => it.correctLabel) });
  }
  return variants;
}

/**
 * Chấm 1 bài làm so với đáp án của mã đề.
 * @param {string[]|string} answers mảng nhãn hoặc chuỗi "ABDCA...".
 * @param {string[]} key đáp án đúng theo vị trí.
 */
export function gradeOne(answers, key) {
  const arr = Array.isArray(answers)
    ? answers.map((x) => String(x || '').trim().toUpperCase())
    : String(answers || '').toUpperCase().replace(/[^A-H]/g, '').split('');
  const detail = key.map((k, i) => {
    const a = arr[i] || '';
    return { num: i + 1, student: a, correct: k, ok: a === k };
  });
  const correct = detail.filter((d) => d.ok).length;
  const total = key.length;
  const score = total ? Math.round((correct / total) * 10 * 100) / 100 : 0;
  return { correct, wrong: total - correct, total, score, detail };
}

/** CSV đáp án các mã đề. */
export function answerKeyCsv(variants) {
  const lines = ['Mã đề,' + variants[0]?.key.map((_, i) => `C${i + 1}`).join(',')];
  variants.forEach((v) => lines.push(v.code + ',' + v.key.join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** CSV kết quả chấm điểm. */
export function resultsCsv(results) {
  const header = 'MSSV,Họ tên,Mã đề,Số đúng,Số sai,Tổng,Điểm';
  const lines = [header];
  results.forEach((r) => {
    const esc = (s) => (/[",\n]/.test(String(s)) ? '"' + String(s).replace(/"/g, '""') + '"' : String(s));
    lines.push([r.studentId, r.studentName, r.examCode, r.correct, r.wrong, r.total, r.score].map(esc).join(','));
  });
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/**
 * Phân tích bảng bài làm học sinh (dán/CSV). Mỗi dòng:
 *   MSSV, Họ tên, Mã đề, Chuỗi đáp án (vd: ABDCA...)
 */
export function parseStudentRows(text) {
  const rows = [];
  const errors = [];
  String(text || '').replace(/\r/g, '').split('\n').forEach((line, i) => {
    const t = line.trim();
    if (!t) return;
    const parts = t.split(/[\t,;]/).map((x) => x.trim());
    if (parts.length < 4) { errors.push(`Dòng ${i + 1}: cần 4 cột (MSSV, Họ tên, Mã đề, Đáp án).`); return; }
    const [studentId, studentName, examCode, ...rest] = parts;
    rows.push({ studentId, studentName, examCode: String(examCode), answers: rest.join('') });
  });
  return { rows, errors };
}
