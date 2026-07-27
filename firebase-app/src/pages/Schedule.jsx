// Module Lịch giảng dạy: import TKB từ Excel -> hiển thị -> xuất Google Calendar / ICS.
import { useMemo, useState } from 'react';
import { buildSessions, buildGcalCsv, buildIcs } from '../lib/timetable.js';

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

export default function Schedule() {
  const [week1, setWeek1] = useState(''); // Thứ 2 tuần 1 (yyyy-mm-dd)
  const [offset, setOffset] = useState(0); // dịch tuần (±)
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState(null); // dữ liệu sheet dạng mảng-các-mảng
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [weekFilter, setWeekFilter] = useState('all');

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      // Nạp thư viện đọc Excel theo yêu cầu (giảm bundle ban đầu).
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' });
      setRows(data);
      setFileName(file.name);
      setWeekFilter('all');
    } catch (err) {
      setError('Không đọc được file Excel: ' + (err?.message || err));
      setRows(null);
    } finally {
      setBusy(false);
    }
  }

  // baseMonday = Thứ 2 tuần 1 + offset tuần. Dùng giờ trưa để tránh lệch múi giờ.
  const baseMonday = useMemo(() => {
    if (!week1) return null;
    const d = new Date(week1 + 'T12:00:00');
    if (isNaN(d.getTime())) return null;
    d.setDate(d.getDate() + Number(offset || 0) * 7);
    return d;
  }, [week1, offset]);

  const sessions = useMemo(() => {
    if (!rows || !baseMonday) return [];
    try {
      return buildSessions(rows, baseMonday);
    } catch {
      return [];
    }
  }, [rows, baseMonday]);

  const weeks = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.week))).sort((a, b) => a - b),
    [sessions]
  );

  const visible = useMemo(
    () => (weekFilter === 'all' ? sessions : sessions.filter((s) => String(s.week) === String(weekFilter))),
    [sessions, weekFilter]
  );

  function exportCsv() {
    downloadFile('TKB_GoogleCalendar.csv', buildGcalCsv(sessions), 'text/csv;charset=utf-8');
  }
  function exportIcs() {
    downloadFile('TKB.ics', buildIcs(sessions), 'text/calendar;charset=utf-8');
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
            <input type="date" value={week1} onChange={(e) => setWeek1(e.target.value)} />
          </label>
          <label className="sched-field sched-offset">
            3. Dịch tuần (±)
            <input
              type="number"
              value={offset}
              onChange={(e) => setOffset(e.target.value)}
            />
          </label>
        </div>

        {fileName && <p className="muted">Đã nạp: <strong>{fileName}</strong></p>}
        {busy && <p className="muted">Đang đọc file…</p>}
        {error && <div className="error-box">{error}</div>}
        {rows && !baseMonday && (
          <div className="hint-box">Hãy chọn <strong>Ngày Thứ 2 của Tuần 1</strong> để tính lịch.</div>
        )}

        {ready && (
          <div className="sched-actions">
            <span className="muted">{sessions.length} buổi học</span>
            <button className="btn btn-primary" onClick={exportCsv} disabled={!sessions.length}>
              Xuất CSV (Google Calendar)
            </button>
            <button className="btn btn-google" onClick={exportIcs} disabled={!sessions.length}>
              Xuất .ics
            </button>
          </div>
        )}
      </div>

      {ready && sessions.length > 0 && (
        <>
          <div className="filter-row">
            <label className="muted" style={{ margin: 0 }}>Lọc theo tuần:&nbsp;</label>
            <select value={weekFilter} onChange={(e) => setWeekFilter(e.target.value)} style={{ width: 'auto' }}>
              <option value="all">Tất cả ({sessions.length})</option>
              {weeks.map((w) => (
                <option key={w} value={w}>Tuần {w}</option>
              ))}
            </select>
          </div>

          <div className="table-wrap">
            <table className="sched-table">
              <thead>
                <tr>
                  <th>Tuần</th><th>Thứ</th><th>Ngày</th><th>Tiết</th><th>Giờ</th>
                  <th>Lớp - Môn</th><th>Phòng</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((s, i) => (
                  <tr key={i}>
                    <td>{s.week}</td>
                    <td>{s.thuLabel}</td>
                    <td>{s.date}</td>
                    <td>{s.p1}–{s.p2}</td>
                    <td>{s.startTime}–{s.endTime}</td>
                    <td>{s.subject}</td>
                    <td>{s.room}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {ready && sessions.length === 0 && !busy && (
        <div className="hint-box">Không tạo được buổi học nào từ file. Kiểm tra lại đúng file TKB của trường.</div>
      )}

      <div className="card sched-help">
        <strong>Hướng dẫn nhanh</strong>
        <ol>
          <li>Chọn file TKB xuất từ hệ thống trường (giữ nguyên định dạng).</li>
          <li>Chọn ngày <strong>Thứ 2 của Tuần 1</strong> (tuần đầu học kỳ). Nếu lệch, dùng ô "Dịch tuần".</li>
          <li>Bấm <strong>Xuất CSV</strong> rồi vào Google Calendar → <em>Settings → Import &amp; export → Import</em> để nạp. Hoặc <strong>Xuất .ics</strong> mở bằng ứng dụng lịch.</li>
        </ol>
      </div>
    </div>
  );
}
