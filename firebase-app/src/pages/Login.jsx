// Trang đăng nhập / đăng ký: Email/mật khẩu, Số điện thoại (OTP), Google.
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.jsx';

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [method, setMethod] = useState('email'); // 'email' | 'phone'

  // Đã đăng nhập rồi thì chuyển thẳng vào trong.
  if (user) {
    navigate('/', { replace: true });
    return null;
  }

  return (
    <div className="center-screen">
      <div className="card auth-card">
        <h1>Trung tâm công việc cá nhân</h1>

        <div className="method-tabs">
          <button
            className={method === 'email' ? 'tab active' : 'tab'}
            onClick={() => setMethod('email')}
          >
            Email
          </button>
          <button
            className={method === 'phone' ? 'tab active' : 'tab'}
            onClick={() => setMethod('phone')}
          >
            Số điện thoại
          </button>
        </div>

        {method === 'email' ? <EmailForm /> : <PhoneForm />}

        <GoogleButton />
      </div>
    </div>
  );
}

/* ---------------- Email / mật khẩu ---------------- */
function EmailForm() {
  const { loginEmail, registerEmail } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await loginEmail(email, password);
      else await registerEmail(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">{mode === 'login' ? 'Đăng nhập bằng email' : 'Tạo tài khoản mới'}</p>
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
    </>
  );
}

/* ---------------- Số điện thoại (OTP) ---------------- */
function PhoneForm() {
  const { makeRecaptcha, sendPhoneOtp } = useAuth();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState('phone'); // 'phone' | 'code'
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const confirmationRef = useRef(null);
  const recaptchaRef = useRef(null);

  async function sendOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      // Tạo reCAPTCHA (một lần) rồi gửi OTP.
      if (!recaptchaRef.current) {
        recaptchaRef.current = makeRecaptcha('recaptcha-container');
      }
      const e164 = toE164(phone);
      confirmationRef.current = await sendPhoneOtp(e164, recaptchaRef.current);
      setStep('code');
    } catch (err) {
      setError(translateError(err));
      // Reset reCAPTCHA để lần sau tạo lại.
      if (recaptchaRef.current) {
        recaptchaRef.current.clear();
        recaptchaRef.current = null;
      }
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await confirmationRef.current.confirm(code);
      navigate('/', { replace: true });
    } catch (err) {
      setError(translateError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <p className="muted">Đăng nhập bằng số điện thoại</p>
      {step === 'phone' ? (
        <form onSubmit={sendOtp}>
          <label>
            Số điện thoại
            <input
              type="tel"
              placeholder="0912345678"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              required
              autoComplete="tel"
            />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Đang gửi…' : 'Gửi mã OTP'}
          </button>
        </form>
      ) : (
        <form onSubmit={verifyOtp}>
          <label>
            Mã OTP (gửi tới {toE164(phone)})
            <input
              type="text"
              inputMode="numeric"
              placeholder="6 chữ số"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
          </label>
          {error && <div className="error-box">{error}</div>}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? 'Đang xác thực…' : 'Xác nhận'}
          </button>
          <button
            type="button"
            className="link"
            style={{ marginTop: '0.75rem' }}
            onClick={() => {
              setStep('phone');
              setCode('');
              setError('');
            }}
          >
            Đổi số điện thoại
          </button>
        </form>
      )}
      {/* reCAPTCHA vô hình (bắt buộc cho phone auth trên web). */}
      <div id="recaptcha-container" />
    </>
  );
}

/* ---------------- Google ---------------- */
function GoogleButton() {
  const { loginGoogle } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
    <>
      <div className="divider">hoặc</div>
      <button className="btn btn-google" onClick={handleGoogle} disabled={busy}>
        Đăng nhập bằng Google
      </button>
      {error && <div className="error-box">{error}</div>}
    </>
  );
}

/** Chuẩn hóa số điện thoại Việt Nam về định dạng E.164 (+84...). */
function toE164(input) {
  const s = (input || '').replace(/[\s.-]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) return '+84' + s.slice(1);
  if (s.startsWith('84')) return '+' + s;
  return '+84' + s;
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
    'auth/invalid-phone-number': 'Số điện thoại không hợp lệ.',
    'auth/missing-phone-number': 'Vui lòng nhập số điện thoại.',
    'auth/invalid-verification-code': 'Mã OTP không đúng.',
    'auth/code-expired': 'Mã OTP đã hết hạn, vui lòng gửi lại.',
    'auth/too-many-requests': 'Quá nhiều yêu cầu, vui lòng thử lại sau.',
    'auth/quota-exceeded': 'Đã vượt hạn mức gửi SMS.',
    'auth/captcha-check-failed': 'Xác thực reCAPTCHA thất bại.',
    'auth/operation-not-allowed': 'Phương thức đăng nhập này chưa được bật trong Firebase Console.',
  };
  return map[code] || err?.message || 'Có lỗi xảy ra, vui lòng thử lại.';
}
