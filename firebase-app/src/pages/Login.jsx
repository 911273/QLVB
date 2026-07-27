// Trang đăng nhập / đăng ký (email + Google).
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Login() {
  const { user, loginEmail, registerEmail, loginGoogle } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // Đã đăng nhập rồi thì chuyển thẳng vào trong.
  if (user) {
    navigate('/', { replace: true });
    return null;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        await loginEmail(email, password);
      } else {
        await registerEmail(email, password);
      }
      navigate('/', { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    setError('');
    setBusy(true);
    try {
      await loginGoogle();
      navigate('/', { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <h1>Trung tâm công việc cá nhân</h1>
        <p className="muted">{mode === 'login' ? 'Đăng nhập để tiếp tục' : 'Tạo tài khoản mới'}</p>

        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
            />
          </label>
          <label>
            Mật khẩu
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error && <div className="error-box">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Đang xử lý…' : mode === 'login' ? 'Đăng nhập' : 'Đăng ký'}
          </button>
        </form>

        <button className="btn btn-google" onClick={handleGoogle} disabled={busy}>
          Đăng nhập bằng Google
        </button>

        <p className="switch-mode">
          {mode === 'login' ? 'Chưa có tài khoản?' : 'Đã có tài khoản?'}{' '}
          <button
            type="button"
            className="link"
            onClick={() => setMode(mode === 'login' ? 'register' : 'login')}
          >
            {mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}
          </button>
        </p>
      </div>
    </div>
  );
}

/** Dịch một số mã lỗi Firebase Auth phổ biến sang tiếng Việt. */
function translateError(err) {
  const code = err?.code || '';
  const map = {
    'auth/invalid-credential': 'Email hoặc mật khẩu không đúng.',
    'auth/invalid-email': 'Email không hợp lệ.',
    'auth/user-not-found': 'Không tìm thấy tài khoản.',
    'auth/wrong-password': 'Mật khẩu không đúng.',
    'auth/email-already-in-use': 'Email đã được đăng ký.',
    'auth/weak-password': 'Mật khẩu quá yếu (tối thiểu 6 ký tự).',
    'auth/popup-closed-by-user': 'Bạn đã đóng cửa sổ đăng nhập Google.',
  };
  return map[code] || err?.message || 'Có lỗi xảy ra, vui lòng thử lại.';
}
