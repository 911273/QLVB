// Quản lý trạng thái đăng nhập toàn app qua React Context.
import { createContext, useContext, useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
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
    logout: () => signOut(auth),
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
