# Điện‑Nước — Hướng dẫn chạy trên **Web** (Local + Deploy)

> File này dành cho môi trường **trình duyệt** (PC/Laptop, Chrome/Edge/Firefox). In Bluetooth 58mm chỉ hoạt động trong **APK**; trên web vẫn in được qua hộp thoại trình duyệt.

---
LƯU Ý: KHÔNG SỬ DỤNG VỚI MỤC ĐÍCH THƯƠNG MẠI!!!!
MỌI BẢN QUYỀN ĐỀU THUỘC SỞ HỮU CỦA TRẦN ĐÌNH DƯƠNG!!!

## 1) Yêu cầu môi trường

* **Node.js** LTS (khuyến nghị ≥ 18). Kiểm tra:

  ```bash
  node -v
  npm -v
  ```
* **Git** (tùy chọn, nếu clone repo).
* Trình duyệt cập nhật (Chrome/Edge/Firefox). Bật **Local Storage** và **IndexedDB** mặc định.

> Nếu trước đó đã cài Node bản quá cũ, hãy nâng cấp rồi mở **Terminal mới**.

---

## 2) Tải mã nguồn

Chọn **một** trong hai cách:

**a) Clone repo**

```bash
git clone <YOUR_REPO_URL> dien-nuoc-app
cd dien-nuoc-app
```

**b) Giải nén .zip**
Tải file .zip của dự án → giải nén → **mở thư mục gốc** của dự án trong VS Code.

---

## 3) Cài thư viện

```bash
npm install
```

> Lỗi mạng khi cài (ETIMEDOUT/ECONNRESET): chạy lại `npm install`, hoặc đổi mạng/đổi registry:
> `npm config set registry https://registry.npmjs.org/`

---

## 4) Cấu hình (tùy chọn)

Các phần sau **đã có giá trị mặc định** để chạy web:

* **Firebase/Room**: không bắt buộc khi chạy local. Nếu muốn đồng bộ phòng (room) qua Firestore:

  * Mở `src/sync/firebase.js` và `src/sync/room.js` → giữ **config hiện có**.
  * Tính năng sync chỉ kích hoạt khi bạn tham gia phòng (isInRoom = true).

* **In 58mm**: trên web in qua hộp thoại trình duyệt, **không** dùng Bluetooth plugin.

* **PWA**: Web app có thể chạy như PWA (Add to Home Screen). Khi dev, để tránh cache cũ, **hard refresh**: `Ctrl+F5`.

> Không cần chỉnh gì thêm để chạy local.

---

## 5) Chạy trên máy (dev server)

```bash
npm run dev
```

Sau đó mở đường dẫn mà Terminal in ra, ví dụ:

```
  Local:   http://localhost:5173/
```

### Lưu ý khi dev

* Lần đầu vào trang nếu trống dữ liệu → vào **Quản lý** để thêm cư dân.
* Tính năng **Sao lưu/Phục hồi**: `Cài đặt → Sao lưu & Phục hồi`.
* **In (web)**: `Chi tiết → In biên lai (58mm)` → In trình duyệt.
  Nếu muốn Bluetooth → dùng **bản APK**.

---

## 6) Build bản web (static)

Tạo gói static để deploy lên hosting tĩnh (GitHub Pages/Netlify/Vercel/Nginx):

```bash
npm run build
npm run preview   # (tuỳ chọn) kiểm tra gói build
```

* Thư mục xuất ra: `dist/`
* Triển khai: upload toàn bộ nội dung **bên trong** `dist/` lên host tĩnh.

### Deploy nhanh với GitHub Pages

1. Commit/push toàn bộ dự án lên GitHub.
2. Cài action sẵn có (tuỳ theo template) **hoặc** dùng `gh-pages`:

   ```bash
   npm i -D gh-pages
   npm run build
   npx gh-pages -d dist
   ```
3. Sau khi deploy, trang sẽ có URL dạng `https://<user>.github.io/<repo>/`.

> Nếu site đặt **base path** con (ví dụ `/dien-nuoc-app/`), cần đảm bảo cấu hình base trong `vite.config.*` (nếu đã có). Mặc định dự án hoạt động tốt ở root.

---

## 7) Dữ liệu & trình duyệt

* Dữ liệu đang dùng **LocalStorage + IndexedDB** của trình duyệt.
* Khi **xóa cache**/đổi trình duyệt/đổi máy → dữ liệu local sẽ khác.
* Nên **Sao lưu** trước khi:

  * Nâng cấp bản mới
  * Xoá lịch sử trình duyệt
  * Đổi máy

> Có cơ chế **Auto‑backup quay vòng** (5 bản gần nhất) trong LocalStorage.

---

## 8) Hạn chế của bản web

* **Bluetooth 58mm**: không khả dụng (yêu cầu APK + cordova‑plugin‑bluetooth‑serial).
* Một số trình duyệt bật chặn popup in: khi bấm In, nếu không thấy hộp thoại → cho phép popup cho site.

---

## 9) Khắc phục sự cố nhanh

**A. `npm install` báo lỗi**

* Kiểm tra mạng/Proxy/Firewall
* Chạy lại: `npm cache verify` rồi `npm install`
* Đổi registry: `npm config set registry https://registry.npmjs.org/`

**B. `npm run dev` chạy nhưng trình duyệt trắng**

* Mở DevTools (F12) tab **Console** xem lỗi.
* Hard refresh: `Ctrl+F5`
* Xoá Service Worker cũ (nếu có): DevTools → Application → Service Workers → Unregister → reload.

**C. Không xem được chữ tiếng Việt đúng khi in**

* Web in qua font monospace của hệ thống; nội dung biên lai dùng **không dấu** để tương thích máy in nhiệt.
* Nếu cần tiếng Việt có dấu trên bản web, xuất **Word/Excel**.

**D. Dữ liệu/đơn giá không khớp sau Import lịch sử**

* Vào **Lịch sử**: nhập lại Excel/CSV, hoặc kiểm tra định dạng cột.
* Sau khi chỉnh sử lịch sử, hệ thống tự **dồn nợ về tháng hiện tại**.

---

## 10) Cấu trúc lệnh NPM chính

```bash
npm run dev       # chạy dev server (hot reload)
npm run build     # build sản phẩm web (ra ./dist)
npm run preview   # chạy preview trên build
```

---

## 11) Hỏi đáp nhanh (FAQ)

**Q: Chạy trên điện thoại được không?**
A: Có, nếu điện thoại cùng mạng LAN, mở URL `http://<IP-máy-PC>:5173/` (Vite in ra trong terminal). Trải nghiệm tốt nhất vẫn là desktop.

**Q: In 58mm Bluetooth sao không thấy?**
A: Chỉ có trong bản APK. Bản web dùng hộp thoại in của trình duyệt (khổ 58mm).

**Q: Muốn đồng bộ nhiều máy?**
A: Dùng tính năng **Room** qua Firestore (tham gia phòng). Nếu không cần, dữ liệu vẫn nằm cục bộ máy đang dùng.

---

## 12) Liên hệ & hỗ trợ

* Khi báo lỗi, hãy gửi ảnh màn hình **Console** (F12 → Console) và mô tả thao tác.
* Trước khi cập nhật bản mới, **Sao lưu** bằng nút trong phần **Cài đặt**.

