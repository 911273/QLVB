# Trung tâm công việc cá nhân (Firebase)

Ứng dụng web cá nhân đa chức năng: **React + Vite** chạy trên **Firebase**
(Hosting + Firestore + Authentication).

## Chức năng

| Module | Trạng thái |
|--------|-----------|
| 🔐 Đăng nhập (email + Google) | ✅ Hoàn chỉnh |
| ✅ Công việc cá nhân (CRUD) | ✅ Hoàn chỉnh |
| 📄 Quản lý văn bản (QLVB) | 🟡 Khung |
| 📝 Trộn đề & chấm | 🟡 Khung |
| 📊 Bảng điểm | 🟡 Khung |
| 📅 Lịch giảng dạy | ⏸️ Tạm gác (lý do bảo mật, xem dưới) |

---

## ⚙️ Bạn cần cài trước

- [Node.js](https://nodejs.org/) 18 trở lên
- Firebase CLI: `npm install -g firebase-tools`

---

## 🚀 Các bước chạy & deploy (làm 1 lần)

> Các bước có **đăng nhập Google** chỉ **bạn** làm được — mình không thể làm thay.

### 1. Tạo Firebase project

1. Vào <https://console.firebase.google.com> → **Add project** → đặt tên (ví dụ `personal-hub`).
2. Trong project, mở **Build → Authentication → Get started**:
   - Bật **Email/Password**.
   - Bật **Google** (chọn email hỗ trợ).
3. Mở **Build → Firestore Database → Create database** → chọn chế độ **Production** → chọn location (ví dụ `asia-southeast1`).
4. Mở **Project settings (⚙️) → General → Your apps → Web (`</>`)** → đăng ký app → **copy đoạn `firebaseConfig`**.

### 2. Cấu hình local

```bash
cd firebase-app
npm install

# Tạo file .env từ mẫu rồi điền giá trị firebaseConfig ở bước 1.4
cp .env.example .env
#   -> mở .env, điền VITE_FIREBASE_* tương ứng

# Trỏ CLI tới project của bạn
cp .firebaserc.example .firebaserc
#   -> sửa "YOUR_FIREBASE_PROJECT_ID" thành Project ID thật
```

### 3. Đăng nhập Firebase CLI (bước này cần TÀI KHOẢN GOOGLE của bạn)

```bash
firebase login
```

Lệnh này mở trình duyệt để **bạn** đăng nhập Google và cấp quyền cho CLI.

### 4. Chạy thử ở máy

```bash
npm run dev
# mở http://localhost:5173
```

### 5. Deploy

```bash
# Deploy toàn bộ (Hosting + Firestore rules + indexes)
npm run deploy

# Hoặc chỉ web:
npm run deploy:hosting
```

Sau khi deploy xong, Firebase in ra URL dạng
`https://<project-id>.web.app` — đó là app của bạn.

> Lần đầu cần đẩy rules/indexes:
> `firebase deploy --only firestore`

---

## 🔐 Bảo mật

- `firestore.rules`: mỗi người dùng **chỉ** đọc/ghi dữ liệu của chính mình
  (mọi document mang field `uid`).
- `.env` **không được commit** (đã có trong `.gitignore`). Các giá trị
  `VITE_FIREBASE_*` không phải bí mật nhưng vẫn nên quản lý riêng theo môi trường.

### ⚠️ Về đồng bộ lịch giảng dạy (eoffice / giangvien.epu.edu.vn)

Chức năng này **cố tình chưa triển khai**. Đăng nhập tự động vào hệ thống
trường bằng **mật khẩu cá nhân nhúng trong app là KHÔNG an toàn** và có thể
vi phạm quy định của trường. Hướng an toàn:

1. Export lịch ra **ICS/Excel** từ hệ thống trường rồi import vào app, **hoặc**
2. Xin **API chính thức** từ phòng CNTT của trường.

> Nếu mật khẩu hệ thống trường của bạn từng bị dán ở đâu đó (chat, ghi chú…),
> hãy **đổi mật khẩu ngay**.

---

## 📁 Cấu trúc

```
firebase-app/
├── firebase.json            # cấu hình Hosting + Firestore
├── firestore.rules          # bảo mật theo user
├── firestore.indexes.json   # index cho truy vấn tasks
├── .env.example             # mẫu Firebase config
├── .firebaserc.example      # mẫu project id
├── index.html
├── vite.config.js
└── src/
    ├── firebase.js          # khởi tạo Firebase
    ├── main.jsx
    ├── App.jsx              # routing
    ├── contexts/AuthContext.jsx
    ├── components/          # Layout, ProtectedRoute, Placeholder
    ├── pages/               # Login, Dashboard, Tasks, Documents, ...
    └── styles/index.css
```

## Mở rộng module mới

1. Tạo `src/pages/TenModule.jsx`.
2. Thêm route trong `src/App.jsx`.
3. Thêm mục vào mảng `NAV` trong `src/components/Layout.jsx`.
4. Nếu cần lưu dữ liệu: dùng collection mới với field `uid`
   (rules hiện có tự áp dụng), thêm index nếu truy vấn phức tạp.
