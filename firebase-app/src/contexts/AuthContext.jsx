// Quản lý trạng thái đăng nhập toàn app qua React Context.
import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  reauthenticateWithPopup,
  linkWithPopup,
  GoogleAuthProvider,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signOut,
} from 'firebase/auth';
import { auth } from '../firebase.js';

const AuthContext = createContext(null);

/** Hook lấy context xác thực. */
export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Lắng nghe thay đổi trạng thái đăng nhập.
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsub;
  }, []);

  const value = {
    user,
    loading,
    loginEmail: (email, password) => signInWithEmailAndPassword(auth, email, password),
    registerEmail: (email, password) => createUserWithEmailAndPassword(auth, email, password),
    loginGoogle: () => signInWithPopup(auth, new GoogleAuthProvider()),

    /**
     * Đăng nhập Google + xin quyền Google Calendar, trả về access token để gọi
     * Calendar API (dùng cho đồng bộ lịch trực tiếp, không cần file).
     * @returns {Promise<string|undefined>} OAuth access token.
     */
    requestCalendarToken: async () => {
      const provider = new GoogleAuthProvider();
      // Scope đầy đủ 'calendar' để tạo/xóa lịch riêng (không chỉ sửa sự kiện).
      provider.addScope('https://www.googleapis.com/auth/calendar');
      const current = auth.currentUser;
      let result;
      if (current) {
        // GIỮ NGUYÊN tài khoản hiện tại: không dùng signInWithPopup (sẽ đổi phiên
        // sang tài khoản Google khác -> mất dữ liệu theo uid cũ). Nếu đã có Google
        // thì reauthenticate; nếu là email/phone thì link Google vào chính uid này.
        const hasGoogle = current.providerData.some((p) => p.providerId === 'google.com');
        try {
          result = hasGoogle
            ? await reauthenticateWithPopup(current, provider)
            : await linkWithPopup(current, provider);
        } catch (e) {
          if (e.code === 'auth/provider-already-linked' || e.code === 'auth/credential-already-in-use') {
            result = await reauthenticateWithPopup(current, provider);
          } else {
            throw e;
          }
        }
      } else {
        result = await signInWithPopup(auth, provider);
      }
      const cred = GoogleAuthProvider.credentialFromResult(result);
      return cred ? cred.accessToken : undefined;
    },

    /**
     * Tạo reCAPTCHA verifier (bắt buộc cho đăng nhập bằng số điện thoại trên web).
     * @param {string} containerId id của phần tử chứa reCAPTCHA.
     * @returns {RecaptchaVerifier}
     */
    makeRecaptcha: (containerId) =>
      new RecaptchaVerifier(auth, containerId, { size: 'invisible' }),

    /**
     * Gửi mã OTP tới số điện thoại (định dạng E.164, ví dụ +84912345678).
     * @param {string} phoneNumber
     * @param {RecaptchaVerifier} appVerifier
     * @returns {Promise<import('firebase/auth').ConfirmationResult>}
     */
    sendPhoneOtp: (phoneNumber, appVerifier) =>
      signInWithPhoneNumber(auth, phoneNumber, appVerifier),

    logout: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
