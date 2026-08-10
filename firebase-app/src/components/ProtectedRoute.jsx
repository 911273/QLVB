// Chặn truy cập các trang cần đăng nhập; chưa login thì đẩy về /login.
import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="center-screen">Đang tải…</div>;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return children;
}
