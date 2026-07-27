// Module Trộn đề & chấm — bản web theo nguyên lý Midx: ngân hàng câu hỏi,
// trộn nhiều mã đề, chấm điểm theo mã đề. Ngân hàng lưu per-user (Firestore).
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import {
  parseQuestions, makeVariants, gradeOne, answerKeyCsv, resultsCsv, parseStudentRows, LABELS,
} from '../lib/quiz.js';

function download(name, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export default function QuizMixer() {
  const { user } = useAuth();
  const [tab, setTab] = useState('bank'); // bank | mix | grade
  const [questions, setQuestions] = useState([]);
  const [variants, setVariants] = useState([]);
  const [saveState, setSaveState] = useState('idle');

  // Khôi phục ngân hàng câu hỏi đã lưu.
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'quizbanks', user.uid));
        if (!cancelled && snap.exists() && snap.data().questionsJson) {
          setQuestions(JSON.parse(snap.data().questionsJson));
          setSaveState('saved');
        }
      } catch { /* Firestore chưa sẵn sàng */ }
    })();
    return () => { cancelled = true; };
  }, [user]);

  async function persist(next) {
    if (!user) return;
    setSaveState('saving');
    try {
      await setDoc(doc(db, 'quizbanks', user.uid), {
        uid: user.uid,
        questionsJson: JSON.stringify(next),
        count: next.length,
        updatedAt: serverTimestamp(),
      });
      setSaveState('saved');
    } catch { setSaveState('error'); }
  }

  function updateQuestions(next) {
    setQuestions(next);
    persist(next);
  }

  return (
    <div>
      <h1>📝 Trộn đề &amp; chấm</h1>

      <div className="method-tabs sched-tabs" style={{ marginBottom: '1rem' }}>
        <button className={tab === 'bank' ? 'tab active' : 'tab'} onClick={() => setTab('bank')}>🏦 Ngân hàng ({questions.length})</button>
        <button className={tab === 'mix' ? 'tab active' : 'tab'} onClick={() => setTab('mix')}>🔀 Trộn đề</button>
        <button className={tab === 'grade' ? 'tab active' : 'tab'} onClick={() => setTab('grade')}>📈 Chấm điểm</button>
      </div>

      {tab === 'bank' && <BankTab questions={questions} updateQuestions={updateQuestions} saveState={saveState} />}
      {tab === 'mix' && <MixTab questions={questions} variants={variants} setVariants={setVariants} download={download} />}
      {tab === 'grade' && <GradeTab variants={variants} download={download} />}
    </div>
  );
}

/* ---------------- Ngân hàng ---------------- */
function BankTab({ questions, updateQuestions, saveState }) {
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');

  function importText() {
    const { questions: parsed, errors } = parseQuestions(text);
    if (!parsed.length) { setMsg('Không nhận được câu hỏi nào. ' + (errors[0] || '')); return; }
    updateQuestions([...questions, ...parsed]);
    setText('');
    setMsg(`Đã thêm ${parsed.length} câu.` + (errors.length ? ` (${errors.length} câu lỗi bị bỏ qua)` : ''));
  }
  function removeQ(id) { updateQuestions(questions.filter((q) => q.id !== id)); }
  function clearAll() { if (confirm('Xóa toàn bộ ngân hàng câu hỏi?')) updateQuestions([]); }

  return (
    <div>
      <div className="card">
        <strong>Nhập câu hỏi (dán hàng loạt)</strong>
        <p className="muted" style={{ margin: '0.4rem 0' }}>
          Mỗi câu cách nhau bằng dòng trống. Đánh dấu <code>*</code> trước đáp án đúng.
        </p>
        <pre className="quiz-example">{`Điện áp định mức của lưới hạ áp Việt Nam?
*A. 220/380V
B. 110/220V
C. 127/220V
D. 380/660V`}</pre>
        <textarea className="quiz-textarea" rows={8} value={text}
          onChange={(e) => setText(e.target.value)} placeholder="Dán danh sách câu hỏi ở đây…" />
        <div className="sched-actions">
          <button className="btn btn-primary" onClick={importText} disabled={!text.trim()}>Thêm vào ngân hàng</button>
          {questions.length > 0 && <button className="btn btn-danger" onClick={clearAll}>Xóa tất cả</button>}
          {saveState === 'saving' && <span className="muted">Đang lưu…</span>}
          {saveState === 'saved' && <span className="save-ok">Đã lưu</span>}
          {saveState === 'error' && <span className="save-err">Chưa lưu được (cần Firestore)</span>}
        </div>
        {msg && <div className="hint-box">{msg}</div>}
      </div>

      {questions.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <strong>Ngân hàng: {questions.length} câu</strong>
          <ol className="quiz-list">
            {questions.map((q) => (
              <li key={q.id}>
                <div className="quiz-q-stem">{q.stem}</div>
                <ul className="quiz-q-opts">
                  {q.options.map((o, i) => (
                    <li key={i} className={o.correct ? 'correct' : ''}>
                      <strong>{LABELS[i]}.</strong> {o.text}{o.correct && ' ✓'}
                    </li>
                  ))}
                </ul>
                <button className="btn btn-danger btn-sm" onClick={() => removeQ(q.id)}>Xóa</button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/* ---------------- Trộn đề ---------------- */
function MixTab({ questions, variants, setVariants, download }) {
  const [numQuestions, setNumQuestions] = useState('');
  const [numVariants, setNumVariants] = useState(4);
  const [shuffleAnswers, setShuffleAnswers] = useState(true);
  const [startCode, setStartCode] = useState(101);
  const [preview, setPreview] = useState(0);

  function generate() {
    const nv = Math.max(1, Number(numVariants) || 1);
    const nq = Number(numQuestions) || 0;
    setVariants(makeVariants(questions, {
      numQuestions: nq, numVariants: nv, shuffleAnswers, startCode: Number(startCode) || 101,
    }));
    setPreview(0);
  }

  function exportExamText() {
    const lines = [];
    variants.forEach((v) => {
      lines.push(`===== MÃ ĐỀ ${v.code} =====\n`);
      v.items.forEach((it) => {
        lines.push(`Câu ${it.position}: ${it.stem}`);
        it.options.forEach((o, i) => lines.push(`   ${LABELS[i]}. ${o}`));
        lines.push('');
      });
      lines.push('\n');
    });
    download('DeThi.txt', lines.join('\n'), 'text/plain;charset=utf-8');
  }

  if (!questions.length) return <div className="hint-box">Ngân hàng đang trống. Hãy thêm câu hỏi ở tab <strong>Ngân hàng</strong>.</div>;

  const v = variants[preview];
  return (
    <div>
      <div className="card">
        <div className="sched-row">
          <label className="sched-field sched-offset">Số câu / đề (0 = tất cả)
            <input type="number" min="0" value={numQuestions} onChange={(e) => setNumQuestions(e.target.value)} placeholder={String(questions.length)} />
          </label>
          <label className="sched-field sched-offset">Số mã đề
            <input type="number" min="1" value={numVariants} onChange={(e) => setNumVariants(e.target.value)} />
          </label>
          <label className="sched-field sched-offset">Mã đề bắt đầu
            <input type="number" value={startCode} onChange={(e) => setStartCode(e.target.value)} />
          </label>
          <label className="sched-field" style={{ justifyContent: 'flex-end' }}>
            <span><input type="checkbox" checked={shuffleAnswers} onChange={(e) => setShuffleAnswers(e.target.checked)} /> Trộn cả đáp án</span>
          </label>
        </div>
        <div className="sched-actions">
          <button className="btn btn-primary" onClick={generate}>Sinh mã đề</button>
          {variants.length > 0 && <>
            <button className="btn btn-google" onClick={exportExamText}>Xuất đề (.txt)</button>
            <button className="btn btn-google" onClick={() => download('DapAn.csv', answerKeyCsv(variants), 'text/csv;charset=utf-8')}>Xuất đáp án (CSV)</button>
          </>}
        </div>
      </div>

      {variants.length > 0 && (
        <>
          <div className="card" style={{ marginTop: '1rem' }}>
            <strong>Bảng đáp án ({variants.length} mã đề)</strong>
            <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
              <table className="sched-table">
                <thead><tr><th>Mã đề</th>{variants[0].key.map((_, i) => <th key={i}>C{i + 1}</th>)}</tr></thead>
                <tbody>
                  {variants.map((vr) => (
                    <tr key={vr.code}><td><strong>{vr.code}</strong></td>{vr.key.map((k, i) => <td key={i}>{k}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginTop: '1rem' }}>
            <div className="week-nav">
              <strong>Xem trước đề:</strong>
              <select value={preview} onChange={(e) => setPreview(Number(e.target.value))} style={{ width: 'auto' }}>
                {variants.map((vr, i) => <option key={vr.code} value={i}>Mã đề {vr.code}</option>)}
              </select>
            </div>
            <ol className="quiz-list">
              {v.items.map((it) => (
                <li key={it.position}>
                  <div className="quiz-q-stem">{it.stem}</div>
                  <ul className="quiz-q-opts">
                    {it.options.map((o, i) => (
                      <li key={i} className={LABELS[i] === it.correctLabel ? 'correct' : ''}>
                        <strong>{LABELS[i]}.</strong> {o}{LABELS[i] === it.correctLabel && ' ✓'}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------- Chấm điểm ---------------- */
function GradeTab({ variants, download }) {
  const [text, setText] = useState('');
  const [results, setResults] = useState([]);
  const [msg, setMsg] = useState('');

  const keyByCode = useMemo(() => {
    const m = {};
    variants.forEach((v) => { m[String(v.code)] = v.key; });
    return m;
  }, [variants]);

  function grade() {
    const { rows, errors } = parseStudentRows(text);
    if (!rows.length) { setMsg('Không đọc được bài làm nào. ' + (errors[0] || '')); return; }
    const out = [];
    let noKey = 0;
    rows.forEach((r) => {
      const key = keyByCode[r.examCode];
      if (!key) { noKey++; return; }
      const g = gradeOne(r.answers, key);
      out.push({ ...r, ...g });
    });
    setResults(out);
    setMsg(`Đã chấm ${out.length} bài.` + (noKey ? ` ${noKey} bài sai mã đề (không có trong đề đã sinh).` : ''));
  }

  if (!variants.length) return <div className="hint-box">Chưa có mã đề. Hãy sang tab <strong>Trộn đề</strong> bấm "Sinh mã đề" trước.</div>;

  const avg = results.length ? (results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2) : 0;

  return (
    <div>
      <div className="card">
        <strong>Nhập bài làm học sinh</strong>
        <p className="muted" style={{ margin: '0.4rem 0' }}>Mỗi dòng: <code>MSSV, Họ tên, Mã đề, Đáp án</code> (vd: <code>2021001, Nguyễn A, 101, ABDCA</code>).</p>
        <textarea className="quiz-textarea" rows={6} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={'2021001, Nguyễn Văn A, 101, ABDCADBCA\n2021002, Trần Thị B, 102, BCDABACDB'} />
        <div className="sched-actions">
          <button className="btn btn-primary" onClick={grade} disabled={!text.trim()}>Chấm điểm</button>
          {results.length > 0 && <button className="btn btn-google" onClick={() => download('KetQua.csv', resultsCsv(results), 'text/csv;charset=utf-8')}>Xuất kết quả (CSV)</button>}
        </div>
        {msg && <div className="hint-box">{msg}</div>}
      </div>

      {results.length > 0 && (
        <div className="card" style={{ marginTop: '1rem' }}>
          <strong>Kết quả — điểm trung bình: {avg}/10</strong>
          <div className="table-wrap" style={{ marginTop: '0.5rem' }}>
            <table className="sched-table">
              <thead><tr><th>MSSV</th><th>Họ tên</th><th>Mã đề</th><th>Đúng</th><th>Sai</th><th>Điểm</th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td>{r.studentId}</td><td>{r.studentName}</td><td>{r.examCode}</td>
                    <td>{r.correct}</td><td>{r.wrong}</td>
                    <td><strong>{r.score}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
