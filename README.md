<p align="center">
  <img src="public/icons/6.png" alt="Điện Nước Logo" width="100" />
</p>

<h1 align="center">⚡💧 Quản Lý Ghi Số Điện Nước</h1>

<p align="center">
  Ứng dụng ghi chỉ số điện nước, tính tiền tự động, quản lý công nợ và xuất phiếu thu — hỗ trợ cả <b>PWA</b> lẫn <b>Android APK</b>.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vite-7.x-646CFF?logo=vite&logoColor=white" />
  <img src="https://img.shields.io/badge/Vanilla_JS-ES2022-F7DF1E?logo=javascript&logoColor=black" />
  <img src="https://img.shields.io/badge/Capacitor-5.x-119EFF?logo=capacitor&logoColor=white" />
  <img src="https://img.shields.io/badge/Firebase-Firestore-FFCA28?logo=firebase&logoColor=black" />
  <img src="https://img.shields.io/badge/PWA-Offline_Ready-5A0FC8?logo=pwa&logoColor=white" />
</p>

---

## 📋 Mục Lục

- [Giới Thiệu](#-giới-thiệu)
- [Tính Năng](#-tính-năng)
- [Tech Stack](#-tech-stack)
- [Cấu Trúc Dự Án](#-cấu-trúc-dự-án)
- [Cài Đặt & Chạy](#-cài-đặt--chạy)
- [Build & Triển Khai](#-build--triển-khai)
- [Hướng Dẫn Sử Dụng](#-hướng-dẫn-sử-dụng)
- [Đóng Góp](#-đóng-góp)
- [Giấy Phép](#-giấy-phép)

---

## 📖 Giới Thiệu

**Điện Nước App** là ứng dụng quản lý ghi chỉ số điện nước dành cho **chủ nhà trọ, khu trọ, chung cư mini**. Ứng dụng giúp:

- Ghi nhận chỉ số điện nước hàng tháng cho từng cư dân / phòng
- Tự động tính tiền dựa trên bảng giá cấu hình được
- Theo dõi lịch sử, công nợ, trả trước qua các tháng
- Xuất phiếu thu dạng **Word (.docx)** và **Excel (.xlsx)**
- In phiếu qua **máy in Bluetooth** (ESC/POS)
- Đồng bộ dữ liệu real-time qua **Firebase Firestore**

> 🌐 Chạy trên trình duyệt (PWA – hoạt động offline) hoặc đóng gói thành **APK Android** qua Capacitor.

---

## ✨ Tính Năng

| Tính năng                  | Mô tả                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| 📝 **Ghi chỉ số**          | Nhập chỉ số điện / nước mới, so sánh với chỉ số cũ, tính số tiêu thụ                         |
| 💰 **Tính tiền tự động**   | Áp dụng đơn giá cấu hình cho điện, nước, phòng, phụ phí                                      |
| 📊 **Lịch sử & công nợ**   | Xem lại lịch sử theo tháng, tự động chuỗi nợ (debt chain) khi thay đổi trạng thái thanh toán |
| 🏠 **Quản lý phòng**       | Thêm / sửa / xoá cư dân, gán theo phòng (zone)                                               |
| 📄 **Xuất phiếu Word**     | Tạo phiếu thu `.docx` từ mẫu tuỳ chỉnh                                                       |
| 📊 **Xuất Excel**          | Xuất bảng tổng hợp `.xlsx` cho tất cả cư dân                                                 |
| 🖨️ **In Bluetooth**        | In phiếu thu qua máy in nhiệt ESC/POS kết nối Bluetooth                                      |
| 📱 **QR Code**             | Quét / tạo mã QR để chia sẻ thông tin nhanh                                                  |
| 🔄 **Đồng bộ Firebase**    | Real-time sync qua Firestore – nhiều thiết bị cùng dùng chung dữ liệu                        |
| 👥 **Phòng cộng tác**      | Tạo / tham gia phòng để nhiều người quản lý cùng lúc                                         |
| 🌙 **Dark / Light mode**   | Chuyển giao diện sáng / tối, đồng bộ StatusBar trên Android                                  |
| 📶 **Offline-first (PWA)** | Service Worker cache – hoạt động ngay cả khi mất mạng                                        |
| 💾 **Backup / Restore**    | Sao lưu & khôi phục dữ liệu (import từ Excel)                                                |

---

## 🛠 Tech Stack

| Công nghệ                           | Vai trò                                   |
| ----------------------------------- | ----------------------------------------- |
| **Vite 7**                          | Build tool & dev server                   |
| **Vanilla JavaScript (ES Modules)** | Logic ứng dụng – không framework          |
| **HTML5 + CSS3**                    | Giao diện responsive, hỗ trợ safe-area    |
| **Capacitor 5**                     | Đóng gói APK Android, truy cập native API |
| **Firebase Firestore**              | Cơ sở dữ liệu cloud, đồng bộ real-time    |
| **vite-plugin-pwa**                 | Tạo Service Worker cho PWA                |
| **docx**                            | Tạo file Word (.docx) phía client         |
| **ExcelJS / SheetJS**               | Đọc & ghi file Excel (.xlsx)              |
| **jsQR / qrcode**                   | Quét & tạo mã QR                          |
| **ESC/POS**                         | Giao thức in nhiệt qua Bluetooth          |

---

## 📁 Cấu Trúc Dự Án

```
dien-nuoc-app/
├── index.html                 # Entry point HTML
├── vite.config.js             # Cấu hình Vite (PWA + Capacitor)
├── capacitor.config.json      # Cấu hình Capacitor (Android)
├── package.json
│
├── public/                    # Tài nguyên tĩnh (icons)
│
├── src/
│   ├── main.js                # Khởi động app, theme, PWA, Firebase
│   ├── router.js              # SPA hash-based router
│   ├── style.css              # Stylesheet chính
│   │
│   ├── views/                 # Các màn hình chính
│   │   ├── ListView.js        # Danh sách cư dân & ghi chỉ số
│   │   ├── FormView.js        # Form thêm / sửa cư dân
│   │   ├── DetailView.js      # Chi tiết từng cư dân
│   │   ├── ManageView.js      # Quản lý & chỉnh sửa nâng cao
│   │   ├── HistoryView.js     # Lịch sử ghi chỉ số theo tháng
│   │   ├── ConfigView.js      # Cấu hình đơn giá điện/nước
│   │   ├── TemplateView.js    # Tuỳ chỉnh mẫu phiếu thu
│   │   ├── RoomView.js        # Phòng cộng tác (Firebase room)
│   │   └── backupview.js      # Sao lưu & khôi phục dữ liệu
│   │
│   ├── state/                 # Quản lý dữ liệu & logic nghiệp vụ
│   │   ├── storage.js         # LocalStorage wrapper
│   │   ├── readings.js        # Đọc/ghi chỉ số, tính tiền, chuỗi nợ
│   │   ├── history.js         # Lịch sử tháng, rollover
│   │   ├── rates.js           # Bảng giá mặc định
│   │   ├── zones.js           # Phân vùng / khu vực
│   │   ├── backup.js          # Logic backup/restore
│   │   ├── importResidents.js # Import cư dân từ file
│   │   └── xlsxImport.js      # Parse file Excel
│   │
│   ├── sync/                  # Đồng bộ cloud
│   │   ├── firebase.js        # Khởi tạo Firebase
│   │   ├── room.js            # Quản lý phòng cộng tác
│   │   ├── pushQueue.js       # Hàng đợi đồng bộ offline
│   │   └── safeMerge.js       # Merge dữ liệu an toàn
│   │
│   ├── export/                # Xuất file
│   │   ├── word.js            # Xuất phiếu Word (HTML)
│   │   ├── wordDocx.js        # Xuất phiếu Word (.docx)
│   │   └── excel.js           # Xuất bảng Excel
│   │
│   ├── print/                 # In phiếu
│   │   ├── bluetooth.js       # Kết nối máy in Bluetooth
│   │   ├── escpos.js          # Lệnh ESC/POS
│   │   ├── receipt.js         # Format phiếu thu
│   │   ├── preview.js         # Xem trước phiếu
│   │   ├── template.js        # Mẫu phiếu in
│   │   └── qrDecode.js        # Giải mã QR
│   │
│   ├── utils/                 # Tiện ích chung
│   │   ├── date.js            # Xử lý ngày tháng
│   │   ├── format.js          # Định dạng số / tiền
│   │   ├── numeric.js         # Hàm tính toán
│   │   ├── normalize.js       # Chuẩn hoá dữ liệu
│   │   ├── download.js        # Tải file xuống
│   │   └── save.js            # Lưu & xuất dữ liệu
│   │
│   └── ui/                    # UI components dùng chung
│       ├── syncIndicator.js   # Hiển thị trạng thái đồng bộ
│       └── backupFab.js       # Nút floating backup
│
└── android/                   # Project Android (Capacitor)
```

---

## 🚀 Cài Đặt & Chạy

### Yêu cầu

- **Node.js** >= 18
- **npm** >= 9

### Cài đặt

```bash
# Clone repo
git clone https://github.com/Duong200x/App-Web-diennuoc-.git
cd dien-nuoc-app

# Cài dependencies
npm install
```

### Chạy Development Server

```bash
npm run dev
```

Mở trình duyệt tại `http://localhost:5173` để sử dụng.

---

## 📦 Build & Triển Khai

### Build Web (PWA)

```bash
npm run build
```

Thư mục `dist/` chứa bản build tĩnh, có thể deploy lên **Vercel**, **Netlify**, **Firebase Hosting**, hoặc bất kỳ static host nào.

### Build APK Android

```bash
# Build web + sync với Capacitor
npm run build:apk

# Mở Android Studio để build APK
npx cap open android
```

> ⚠️ Cần cài đặt **Android Studio** và **Android SDK** để build APK.

---

## 📱 Hướng Dẫn Sử Dụng

### 1. Thêm cư dân

Vào **"Thêm cư dân"** → Nhập tên, phòng, chỉ số điện nước ban đầu → Lưu.

### 2. Ghi chỉ số hàng tháng

Tại **"Danh sách"** → Nhập chỉ số mới cho từng cư dân → Hệ thống tự tính tiền tiêu thụ.

### 3. Xem lịch sử & công nợ

Vào menu **"Lịch sử"** → Chọn tháng để xem chi tiết, đánh dấu đã thanh toán / chưa thanh toán.

### 4. Điều chỉnh giá

Vào menu **"Điều chỉnh giá"** → Thay đổi đơn giá điện, nước, tiền phòng, phụ phí.

### 5. Xuất phiếu thu

Tại chi tiết cư dân → Chọn **Xuất Word** hoặc **Xuất Excel** để tải về phiếu thu.

### 6. In qua Bluetooth

Kết nối máy in nhiệt → Chọn **In phiếu** để in trực tiếp qua Bluetooth.

### 7. Đồng bộ nhiều thiết bị

Vào menu **"Phòng"** → Tạo phòng mới hoặc nhập mã phòng → Dữ liệu tự đồng bộ real-time.

---

## 🤝 Đóng Góp

Mọi đóng góp đều được hoan nghênh! Vui lòng:

1. **Fork** repo này
2. Tạo branch: `git checkout -b feature/ten-tinh-nang`
3. Commit: `git commit -m "Thêm tính năng XYZ"`
4. Push: `git push origin feature/ten-tinh-nang`
5. Tạo **Pull Request**

---

## 📄 Giấy Phép

Dự án này được phát triển bởi **[Trần Đình Dương](https://github.com/Duong200x)**.

---

<p align="center">
  Made with ❤️ for landlords in Vietnam 🇻🇳
</p>
