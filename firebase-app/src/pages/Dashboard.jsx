// Trang tổng quan: lối vào nhanh các module.
import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

const MODULES = [
  { to: '/tasks', icon: '✅', title: 'Công việc cá nhân', desc: 'Theo dõi tiến độ công việc.', ready: true },
  { to: '/documents', icon: '📄', title: 'Quản lý văn bản', desc: 'Lưu trữ, phân loại, tìm kiếm.', ready: false },
  { to: '/quiz', icon: '📝', title: 'Trộn đề & chấm', desc: 'Tạo đề trắc nghiệm, chấm điểm.', ready: false },
  { to: '/gradebook', icon: '📊', title: 'Bảng điểm', desc: 'Quản lý điểm các lớp.', ready: false },
  { to: '/schedule', icon: '📅', title: 'Lịch giảng dạy', desc: 'Đồng bộ lịch (tạm gác).', ready: false },
];

export default function Dashboard() {
  const { user } = useAuth();
  return (
    <div>
      <h1>Xin chào{user?.displayName ? `, ${user.displayName}` : ''} 👋</h1>
      <p className="muted">Chọn một chức năng để bắt đầu.</p>
      <div className="module-grid">
        {MODULES.map((m) => (
          <Link key={m.to} to={m.to} className="module-card">
            <div className="module-icon">{m.icon}</div>
            <div className="module-title">{m.title}</div>
            <div className="module-desc">{m.desc}</div>
            {!m.ready && <span className="badge">Đang phát triển</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}
