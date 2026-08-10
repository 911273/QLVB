// Module Quản lý văn bản: nhúng Web App QLVB (Google Apps Script) qua iframe.
// Trang QLVB đã bật XFrameOptionsMode.ALLOWALL nên cho phép nhúng.
import { useState } from 'react';
import { QLVB_EXEC_URL } from '../config.js';

export default function Documents() {
  const [loading, setLoading] = useState(true);

  return (
    <div className="doc-page">
      <div className="doc-header">
        <h1>📄 Quản lý văn bản</h1>
        <a
          className="btn btn-google"
          href={QLVB_EXEC_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          Mở trong tab mới ↗
        </a>
      </div>

      <div className="doc-frame-wrap">
        {loading && <div className="doc-frame-loading">Đang tải QLVB…</div>}
        <iframe
          title="QLVB - Quản lý văn bản"
          src={QLVB_EXEC_URL}
          className="doc-frame"
          onLoad={() => setLoading(false)}
          // Cho phép các tính năng QLVB cần (mở popup Drive, tải file...).
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </div>
  );
}
