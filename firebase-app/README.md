# Trung tâm công việc cá nhân (Firebase)

Ứng dụng web cá nhân đa chức năng: **React + Vite** chạy trên **Firebase**
(Hosting + Firestore + Authentication).

Dùng **project Firebase sẵn có**: project number **`560640156221`**.

> ⚠️ `560640156221` là **project number** (không phải Project ID). Nó chính là
> `messagingSenderId` (đã điền sẵn trong `.env.example`). Để dùng CLI/Hosting
> bạn cần **Project ID** — chuỗi chữ, xem cách lấy ở bước 1.

## Phương thức đăng nhập

- ✅ Email / mật khẩu
- ✅ Google
- ✅ Số điện thoại (OTP qua SMS + reCAPTCHA)

## Chức năng

| Module | Trạng thái |
|--------|-----------|
| 🔐 Đăng nhập (Email + Google + Phone) | ✅ Hoàn chỉnh |
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

## 🚀 Các bước (làm 1 lần)

> Các bước có **đăng nhập Google** chỉ **bạn** làm được — mình không thể làm thay.

### 1. Lấy Project ID & đăng nhập CLI

```bash
npm install -g firebase-tools
firebase login          # ← mở trình duyệt, đăng nhập Google của bạn
```

Tìm **Project ID** ứng với project number `560640156221`:

```bash
firebase projects:list
```

Cột `Project ID` chính là giá trị bạn cần (ví dụ `qlvb-hub-1a2b3`).

### 2. Bật các phương thức đăng nhập (Firebase Console)

Mở project tại <https://console.firebase.google.com> →
**Build → Authentication → Sign-in method**, bật:

- **Email/Password**
- **Google**
- **Phone** — với Phone cần:
  - Vào tab **Settings → Authorized domains**, đảm bảo có `localhost`
    (để test) và domain hosting `*.web.app` / `*.firebaseapp.com`.
  - Có thể thêm **số điện thoại test** (Phone → *Phone numbers for testing*)
    để thử OTP không tốn SMS.

Và bật **Firestore**: **Build → Firestore Database → Create database** →
**Production mode** → location (ví dụ `asia-southeast1`).

### 3. Đăng ký Web App & lấy config

```bash
cd firebase-app

# Đăng ký web app mới trong project (thay <PROJECT_ID> bằng ID ở bước 1)
firebase apps:create web "Personal Hub" --project <PROJECT_ID>

# In ra cấu hình SDK của web app vừa tạo
firebase apps:sdkconfig web --project <PROJECT_ID>
```

Lệnh cuối in ra `apiKey`, `authDomain`, `appId`, ... → dùng để điền `.env`.

### 4. Cấu hình local

```bash
npm install

cp .env.example .env
#   -> điền VITE_FIREBASE_* từ output bước 3
#      (VITE_FIREBASE_MESSAGING_SENDER_ID=560640156221 đã có sẵn)

cp .firebaserc.example .firebaserc
#   -> sửa "YOUR_FIREBASE_PROJECT_ID" thành Project ID thật
```

### 5. Chạy thử & deploy

```bash
npm run dev            # http://localhost:5173

npm run deploy         # build + deploy Hosting + Firestore rules/indexes
# hoặc chỉ web:  npm run deploy:hosting
```

App chạy tại `https://<project-id>.web.app`.

---

## 🔐 Bảo mật & lưu ý Phone Auth

- `firestore.rules`: mỗi người dùng **chỉ** đọc/ghi dữ liệu của chính mình
  (mọi document mang field `uid`).
- `.env` **không commit** (đã có trong `.gitignore`).
- **Phone Auth:**
  - Web dùng **reCAPTCHA vô hình** (đã tích hợp sẵn trong `Login.jsx`).
  - Domain chạy app phải nằm trong **Authorized domains** (bước 2).
  - Có **hạn mức SMS miễn phí/ngày**; vượt mức cần bật billing (gói Blaze).
  - Nên khai báo **số điện thoại test** khi phát triển để khỏi tốn SMS.

### ⚠️ Về đồng bộ lịch giảng dạy (eoffice / giangvien.epu.edu.vn)

Chức năng này **cố tình chưa triển khai**. Đăng nhập tự động vào hệ thống
trường bằng **mật khẩu cá nhân nhúng trong app là KHÔNG an toàn** và có thể
vi phạm quy định của trường. Hướng an toàn: export **ICS/Excel** rồi import,
hoặc xin **API chính thức** từ phòng CNTT.

> Nếu mật khẩu hệ thống trường của bạn từng bị lộ (dán ở chat, ghi chú…),
> hãy **đổi mật khẩu ngay**.

---

## 📁 Cấu trúc

```
firebase-app/
├── firebase.json            # cấu hình Hosting + Firestore
├── firestore.rules          # bảo mật theo user
├── firestore.indexes.json   # index cho truy vấn tasks
├── .env.example             # mẫu Firebase config (đã điền sender id)
├── .firebaserc.example      # mẫu project id
├── index.html
├── vite.config.js
└── src/
    ├── firebase.js          # khởi tạo Firebase
    ├── main.jsx
    ├── App.jsx              # routing
    ├── contexts/AuthContext.jsx   # email + google + phone
    ├── components/          # Layout, ProtectedRoute, Placeholder
    ├── pages/               # Login, Dashboard, Tasks, Documents, ...
    └── styles/index.css
```

## Mở rộng module mới

1. Tạo `src/pages/TenModule.jsx`.
2. Thêm route trong `src/App.jsx`.
3. Thêm mục vào mảng `NAV` trong `src/components/Layout.jsx`.
4. Cần lưu dữ liệu: dùng collection mới với field `uid`
   (rules hiện có tự áp dụng), thêm index nếu truy vấn phức tạp.
