// Khởi tạo Firebase (một lần) và export các service dùng chung.
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// Cảnh báo sớm nếu chưa cấu hình .env (tránh lỗi khó hiểu lúc chạy).
if (!firebaseConfig.apiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    '[firebase] Thiếu cấu hình. Hãy copy .env.example -> .env và điền giá trị từ Firebase Console.'
  );
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
