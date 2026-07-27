// Module Lịch giảng dạy: import TKB Excel -> LƯU per-user (Firestore) -> hiển thị
// (lịch tuần / bảng) -> đồng bộ Google Calendar trực tiếp + xuất CSV/ICS.
import { useEffect, useMemo, useState } from 'react';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase.js';
import { useAuth } from '../contexts/AuthContext.jsx';
import { buildSessions, buildGcalCsv, buildIcs } from '../lib/timetable.js';
import { syncToGoogleCalendar } from '../lib/gcalSync.js';

function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function colorFor(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) % 360;
  return { bg: `hsl(${h} 85% 95%)`, border: `hsl(${h} 70% 55%)`, text: `hsl(${h} 60% 30%)` };
}

const DAY_COLS = [
  { thu: 2, label: 'Thứ 2' }, { thu: 3, label: 'Thứ 3' }, { thu: 4, label: 'Thứ 4' },
  { thu: 5, label: 'Thứ 5' }, { thu: 6, label: 'Thứ 6' }, { thu: 7, label: 'Thứ 7' },
  { thu: 8, label: 'Chủ nhật' },
];

function ymd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function ddmm(dateStr) {
  const [, m, d] = dateStr.split('-');
  return `${d}/${m}`;
}

export default function Schedule() {
  const { user, requestCalendarToken } = useAuth();
  const [week1, setWeek1] = useState('');
  const [offset, setOffset] = useState(0);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState('calendar');
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [saveState, setSaveState] = useState('idle'); // idle | saving | saved | error
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  // Khôi phục lịch đã lưu của người dùng (nếu có).
  useEffect(() => {
    if (!user) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'schedules', user.uid));
        if (cancelled || !snap.exists()) return;
        const d = snap.data();
        if (d.rowsJson) setRows(JSON.parse(d.rowsJson));
        if (d.week1) setWeek1(d.week1);
        if (typeof d.offset !== 'undefined') setOffset(d.offset);
        if (d.fileName) setFileName(d.fileName);
        setSaveState('saved');
      } catch {
        /* Firestore chưa sẵn sàng -> vẫn dùng ngoại tuyến được */
      }
    })();
    return () => { cancelled = true; };
  }, [user]);

  // Lưu lịch (best-effort). Gọi khi import hoặc đổi ngày/dịch tuần.
  async function persist(nextRows, w1, off, fname) {
    if (!user || !nextRows) return;
    setSaveState('saving');
    try {
      await setDoc(doc(db, 'schedules', user.uid), {
        uid: user.uid,
        rowsJson: JSON.stringify(nextRows),
        week1: w1 || '',
        offset: Number(off) || 0,
        fileName: fname || '',
        updatedAt: serverTimestamp(),
      });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      setRows(data);
      setFileName(file.name);
      persist(data, week1, offset, file.name);
    } catch (err) {
      setError('Không đọc được file Excel: ' + (err?.message || err));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  function onWeek1Change(v) {
    setWeek1(v);
    if (rows) persist(rows, v, offset, fileName);
  }
  function onOffsetChange(v) {
    setOffset(v);
    if (rows) persist(rows, week1, v, fileName);
  }

  const baseMonday = useMemo(() => {
    if (!week1) return null;
    const d = new Date(week1 + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + Number(offset || 0) * 7);
    return d;
  }, [week1, offset]);

  const sessions = useMemo(() => {
    if (!rows || !baseMonday) return [];
    try { return buildSessions(rows, baseMonday); } catch { return []; }
  }, [rows, baseMonday]);

  const weeks = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.week))).sort((a, b) => a - b),
    [sessions]
  );

  useEffect(() => {
    if (weeks.length && !weeks.includes(selectedWeek)) setSelectedWeek(weeks[0]);
  }, [weeks, selectedWeek]);

  function exportCsv() {
    downloadFile('TKB_GoogleCalendar.csv', buildGcalCsv(sessions), 'text/csv;charset=utf-8');
  }
  function exportIcs() {
    downloadFile('TKB.ics', buildIcs(sessions), 'text/calendar;charset=utf-8');
  }

  async function handleSync() {
    if (!sessions.length) return;
    setSyncing(true);
    setSyncMsg('Đang xin quyền Google Calendar…');
    try {
      const token = await requestCalendarToken();
      if (!token) throw new Error('Không lấy được quyền Google Calendar.');
      setSyncMsg(`Đang đồng bộ 0/${sessions.length}…`);
      const r = await syncToGoogleCalendar(sessions, token, (d, t) => setSyncMsg(`Đang đồng bộ ${d}/${t}…`));
      let msg = `✅ Xong: thêm ${r.added}, cập nhật ${r.updated}` + (r.failed ? `, lỗi ${r.failed}` : '') + '.';
      if (r.errors.length) msg += ' Lỗi đầu tiên: ' + r.errors[0];
      setSyncMsg(msg);
    } catch (e) {
      setSyncMsg('❌ Lỗi đồng bộ: ' + (e?.message || e));
    } finally {
      setSyncing(false);
    }
  }

  const ready = rows && baseMonday;

  return (
    <div>
      <h1>📅 Lịch giảng dạy</h1>

      <div className="card sched-controls">
        <div className="sched-row">
          <label className="sched-field">
            1. File thời khóa biểu (.xls/.xlsx)
            <input type="file" accept=".xls,.xlsx,.xlsm" onChange={handleFile} />
          </label>
          <label className="sched-field">
            2. Ngày Thứ 2 của Tuần 1
            <input type="date" value={week1} onChange={(e) => onWeek1Change(e.target.value)} />
          </label>
          <label className="sched-field sched-offset">
            3. Dịch tuần (±)
            <input type="number" value={offset} onChange={(e) => onOffsetChange(e.target.value)} />
          </label>
        </div>

        <div className="sched-status">
          {fileName && <span className="muted">Đã nạp: <strong>{fileName}</strong></span>}
          {saveState === 'saving' && <span className="muted">• Đang lưu…</span>}
          {saveState === 'saved' && <span className="save-ok">• Đã lưu (tự khôi phục lần sau)</span>}
          {saveState === 'error' && <span className="save-err">• Chưa lưu được (cần bật Firestore)</span>}
        </div>

        {busy && <p className="muted">Đang đọc file…</p>}
        {error && <div className="error-box">{error}</div>}
        {rows && !baseMonday && (
          <div className="hint-box">Hãy chọn <strong>Ngày Thứ 2 của Tuần 1</strong> để tính lịch.</div>
        )}

        {ready && (
          <div className="sched-actions">
            <span className="muted">{sessions.length} buổi học</span>
            <button className="btn btn-primary" onClick={handleSync} disabled={!sessions.length || syncing}>
              {syncing ? 'Đang đồng bộ…' : '🔄 Đồng bộ Google Calendar'}
            </button>
            <button className="btn btn-google" onClick={exportCsv} disabled={!sessions.length}>
              Xuất CSV
            </button>
            <button className="btn btn-google" onClick={exportIcs} disabled={!sessions.length}>
              Xuất .ics
            </button>
          </div>
        )}
        {syncMsg && <div className="hint-box">{syncMsg}</div>}
      </div>

      {ready && sessions.length > 0 && (
        <>
          <div className="sched-viewbar">
            <div className="method-tabs sched-tabs">
              <button className={view === 'calendar' ? 'tab active' : 'tab'} onClick={() => setView('calendar')}>Lịch tuần</button>
              <button className={view === 'table' ? 'tab active' : 'tab'} onClick={() => setView('table')}>Bảng</button>
            </div>
          </div>

          {view === 'calendar'
            ? <CalendarView sessions={sessions} weeks={weeks} baseMonday={baseMonday}
                selectedWeek={selectedWeek} setSelectedWeek={setSelectedWeek} />
            : <TableView sessions={sessions} weeks={weeks} />}
        </>
      )}

      {ready && sessions.length === 0 && !busy && (
        <div className="hint-box">Không tạo được buổi học nào từ file. Kiểm tra lại đúng file TKB của trường.</div>
      )}

      <div className="card sched-help">
        <strong>Ghi chú</strong>
        <ul>
          <li>Lịch được <strong>lưu theo tài khoản</strong>: lần sau vào là tự hiện, chỉ đổi khi bạn import file mới.</li>
          <li><strong>Đồng bộ Google Calendar</strong>: đăng nhập Gmail &amp; cho phép quyền, các buổi học được ghi thẳng vào lịch chính. Đồng bộ lại sẽ <em>cập nhật</em> đúng buổi cũ (không tạo trùng).</li>
          <li><strong>Xuất CSV</strong>: nạp thủ công qua Google Calendar → <em>Settings → Import &amp; export</em>.</li>
        </ul>
      </div>
    </div>
  );
}

function CalendarView({ sessions, weeks, baseMonday, selectedWeek, setSelectedWeek }) {
  const idx = weeks.indexOf(selectedWeek);
  const week = selectedWeek ?? weeks[0];

  const colDates = useMemo(() => {
    const monday = new Date(baseMonday.getTime());
    monday.setDate(monday.getDate() + (week - 1) * 7);
    return DAY_COLS.map((c, i) => {
      const d = new Date(monday.getTime());
      d.setDate(d.getDate() + i);
      return ymd(d);
    });
  }, [baseMonday, week]);

  const byThu = useMemo(() => {
    const map = {};
    DAY_COLS.forEach((c) => { map[c.thu] = []; });
    sessions.filter((s) => s.week === week).forEach((s) => { map[s.thu]?.push(s); });
    Object.values(map).forEach((arr) => arr.sort((a, b) => a.p1 - b.p1));
    return map;
  }, [sessions, week]);

  return (
    <div>
      <div className="week-nav">
        <button className="btn btn-ghost week-btn" disabled={idx <= 0} onClick={() => setSelectedWeek(weeks[idx - 1])}>‹</button>
        <select value={week} onChange={(e) => setSelectedWeek(Number(e.target.value))}>
          {weeks.map((w) => <option key={w} value={w}>Tuần {w}</option>)}
        </select>
        <button className="btn btn-ghost week-btn" disabled={idx >= weeks.length - 1} onClick={() => setSelectedWeek(weeks[idx + 1])}>›</button>
        <span className="muted week-range">{colDates[0] && `${ddmm(colDates[0])} – ${ddmm(colDates[6])}`}</span>
      </div>

      <div className="cal-grid">
        {DAY_COLS.map((c, i) => (
          <div className="cal-col" key={c.thu}>
            <div className="cal-head">
              <div className="cal-dow">{c.label}</div>
              <div className="cal-date">{colDates[i] ? ddmm(colDates[i]) : ''}</div>
            </div>
            <div className="cal-body">
              {byThu[c.thu].length === 0 && <div className="cal-empty">—</div>}
              {byThu[c.thu].map((s, k) => {
                const col = colorFor(s.class || s.subject);
                return (
                  <div className="cal-event" key={k} style={{ background: col.bg, borderLeftColor: col.border }}>
                    <div className="cal-time">{s.startTime}–{s.endTime} · Tiết {s.p1}-{s.p2}</div>
                    <div className="cal-subj" style={{ color: col.text }}>{s.subject}</div>
                    <div className="cal-room">📍 {s.room}</div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TableView({ sessions, weeks }) {
  const [weekFilter, setWeekFilter] = useState('all');
  const visible = weekFilter === 'all' ? sessions : sessions.filter((s) => String(s.week) === String(weekFilter));
  return (
    <>
      <div className="filter-row">
        <label className="muted" style={{ margin: 0 }}>Lọc theo tuần:&nbsp;</label>
        <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Tất cả ({sessions.length})</option>
          {weeks.map((w) => <option key={w} value={w}>Tuần {w}</option>)}
        </select>
      </div>
      <div className="table-wrap">
        <table className="sched-table">
          <thead>
            <tr><th>Tuần</th><th>Thứ</th><th>Ngày</th><th>Tiết</th><th>Giờ</th><th>Lớp - Môn</th><th>Phòng</th></tr>
          </thead>
          <tbody>
            {visible.map((s, i) => (
              <tr key={i}>
                <td>{s.week}</td><td>{s.thuLabel}</td><td>{s.date}</td>
                <td>{s.p1}–{s.p2}</td><td>{s.startTime}–{s.endTime}</td><td>{s.subject}</td><td>{s.room}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
