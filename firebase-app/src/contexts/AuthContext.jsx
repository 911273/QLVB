// Quản lý trạng thái đăng nhập toàn app qua React Context.
import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
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
