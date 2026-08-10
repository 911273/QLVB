// Module quản lý bảng điểm các lớp - khung.
import Placeholder from '../components/Placeholder.jsx';

export default function Gradebook() {
  return (
    <Placeholder icon="📊" title="Bảng điểm các lớp">
      <p>Module quản lý điểm theo lớp / môn / cột điểm.</p>
      <ul>
        <li>Dữ liệu lưu ở collection <code>grades</code> (mỗi lớp một document).</li>
        <li>Hỗ trợ nhập điểm, tính trung bình, xuất Excel/CSV.</li>
      </ul>
      <p className="muted">Cho mình biết cấu trúc cột điểm (hệ số, thang điểm) để triển khai.</p>
    </Placeholder>
  );
}
