// Cấu hình dùng chung (không bí mật).

// URL Web App QLVB (Google Apps Script) được nhúng vào module Quản lý văn bản.
// Có thể ghi đè bằng biến môi trường VITE_QLVB_EXEC_URL khi build.
export const QLVB_EXEC_URL =
  import.meta.env.VITE_QLVB_EXEC_URL ||
  'https://script.google.com/macros/s/AKfycbzNVfZ5MoFbQjBEJzcUHJriLkxBFdYZCAjYo1tTFpP0_bsYFSlDgd4d7oQLf_Lmhtgy/exec';
