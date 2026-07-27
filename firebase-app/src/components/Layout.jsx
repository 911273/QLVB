// Khung chung: sidebar điều hướng + vùng nội dung (Outlet).
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

const NAV = [
  { to: '/', label: 'Tổng quan', icon: '🏠', end: true },
  { to: '/tasks', label: 'Công việc cá nhân', icon: '✅' },
  { to: '/documents', label: 'Quản lý văn bản', icon: '📄' },
  { to: '/quiz', label: 'Trộn đề & chấm', icon: '📝' },
  { to: '/gradebook', label: 'Bảng điểm', icon: '📊' },
  { to: '/schedule', label: 'Lịch giảng dạy', icon: '📅' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">Trung tâm công việc</div>
        <nav>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className="user-email" title={user?.email || ''}>
            {user?.email || user?.displayName || 'Người dùng'}
          </div>
          <button className="btn btn-ghost" onClick={handleLogout}>
            Đăng xuất
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
