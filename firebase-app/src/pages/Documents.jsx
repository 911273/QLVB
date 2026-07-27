// Module QLVB (quản lý văn bản) - khung, sẵn sàng mở rộng với Firestore.
import Placeholder from '../components/Placeholder.jsx';

export default function Documents() {
  return (
    <Placeholder icon="📄" title="Quản lý văn bản">
      <p>Module này sẽ quản lý văn bản: tải lên, phân loại, tìm kiếm.</p>
      <ul>
        <li>Dữ liệu lưu ở collection <code>documents</code> (Firestore).</li>
        <li>Cần bổ sung Firebase Storage nếu muốn lưu file gốc (PDF, ảnh).</li>
        <li>OCR/phân loại AI nên đặt ở Cloud Functions (cần gói Blaze).</li>
      </ul>
      <p className="muted">Cho mình biết chi tiết chức năng để triển khai đầy đủ.</p>
    </Placeholder>
  );
}
