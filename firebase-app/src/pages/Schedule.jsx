// Module lịch giảng dạy - TẠM GÁC vì lý do bảo mật (xem README).
import Placeholder from '../components/Placeholder.jsx';

export default function Schedule() {
  return (
    <Placeholder icon="📅" title="Lịch giảng dạy">
      <p>
        <strong>Tạm gác.</strong> Việc đồng bộ trực tiếp từ hệ thống trường
        (eoffice.epu.edu.vn / giangvien.epu.edu.vn) bằng mật khẩu cá nhân{' '}
        <strong>không an toàn</strong> và sẽ không được triển khai theo cách đó.
      </p>
      <p>Hướng đi an toàn (đề xuất):</p>
      <ul>
        <li>Export lịch dạng file ICS/Excel từ hệ thống trường rồi import vào đây.</li>
        <li>Hoặc xin API chính thức từ phòng CNTT của trường.</li>
      </ul>
    </Placeholder>
  );
}
