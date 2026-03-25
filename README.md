<p align="center">
  <img src="public/icons/6.png" alt="Logo Điện Nước App" width="96" />
</p>

<h1 align="center">Ứng Dụng Quản Lý Ghi Số Điện Nước</h1>

<p align="center">
  Ứng dụng web/PWA và Android APK giúp gia đình hoặc chủ trọ ghi chỉ số điện nước, tính tiền, theo dõi công nợ, xuất phiếu thu và sao lưu dữ liệu.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Vite-7.x-646CFF?logo=vite&logoColor=white" alt="Vite" />
  <img src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=black" alt="JavaScript" />
  <img src="https://img.shields.io/badge/Capacitor-5.x-119EFF?logo=capacitor&logoColor=white" alt="Capacitor" />
  <img src="https://img.shields.io/badge/Firebase-Firestore-FFCA28?logo=firebase&logoColor=black" alt="Firebase" />
  <img src="https://img.shields.io/badge/PWA-Offline-5A0FC8?logo=pwa&logoColor=white" alt="PWA" />
</p>

## Giới thiệu

Đây là dự án mình làm để phục vụ nhu cầu ghi số điện nước trong thực tế, ưu tiên:

- dễ dùng cho gia đình
- không phụ thuộc vào Excel thủ công
- vẫn dùng được khi mất mạng
- có thể xuất phiếu và in biên lai khi cần

Ứng dụng phù hợp cho:

- gia đình có nhiều phòng
- nhà trọ nhỏ
- khu trọ gia đình
- người muốn quản lý điện nước bằng điện thoại hoặc trình duyệt

## Bài toán ứng dụng giải quyết

Khi ghi điện nước thủ công, thường gặp các vấn đề:

- dễ nhập sai số cũ, số mới
- khó cộng nợ kỳ trước cho đúng
- khó theo dõi ai đã đóng, ai chưa đóng
- dễ mất dữ liệu khi đổi máy hoặc xóa trình duyệt
- mất thời gian khi cần xuất phiếu hoặc in biên lai

Ứng dụng này gom toàn bộ quy trình đó vào một nơi:

- quản lý danh sách cư dân
- ghi chỉ số theo tháng
- tự tính tiền điện, tiền nước
- cộng dồn công nợ
- sao lưu và khôi phục dữ liệu
- đồng bộ nhiều thiết bị qua Firebase nếu cần

## Ảnh giao diện thực tế

Các ảnh dưới đây được chụp trực tiếp từ bản build local của ứng dụng.

### 1. Màn danh sách cư dân

![Màn danh sách cư dân](docs/screenshots/list-overview.png)

### 2. Màn chi tiết cư dân

![Màn chi tiết cư dân](docs/screenshots/detail-resident.png)

### 3. Màn cấu hình giá và sao lưu

![Màn cấu hình giá và sao lưu](docs/screenshots/config-backup.png)

### 4. Màn lịch sử theo tháng

![Màn lịch sử theo tháng](docs/screenshots/history-month.png)

## Tính năng chính

- Ghi chỉ số điện nước theo từng phòng/cư dân
- Tự tính tiền điện và tiền nước từ đơn giá cấu hình
- Theo dõi nợ kỳ trước, tiền đã thu, số còn thiếu
- Chuyển tháng và tạo lịch sử theo từng kỳ
- Quản lý cư dân theo khu
- Tìm kiếm và lọc nhanh theo trạng thái thanh toán
- Xuất Word `.docx`
- Xuất Excel `.xlsx`
- In biên lai 58mm qua Bluetooth trên APK Android
- Chạy offline bằng local storage / IndexedDB
- Sao lưu và khôi phục dữ liệu
- Đồng bộ nhiều thiết bị qua Firebase room

## Điểm kỹ thuật nổi bật

- Logic tính tiền không chỉ là `(số mới - số cũ) * đơn giá`, mà còn xử lý:
  - nợ cũ
  - tiền tạm ứng
  - còn thiếu
  - làm tròn tổng tiền
- Có cơ chế rollover theo tháng và lan truyền công nợ từ lịch sử sang tháng hiện tại
- Có hàng đợi đồng bộ để hạn chế lỗi khi đang offline rồi online lại
- Chung một codebase cho web và Android, chỉ tách riêng phần native như Bluetooth và StatusBar

Các file quan trọng:

- `src/state/readings.js`: tính tiền, nợ, tạm ứng, CRUD cư dân
- `src/state/history.js`: chuyển tháng, snapshot lịch sử, import tháng cũ
- `src/sync/room.js`: đồng bộ Firebase room
- `src/sync/pushQueue.js`: hàng đợi push dữ liệu
- `src/export/wordDocx.js`: xuất file Word
- `src/export/excel.js`: xuất file Excel
- `src/print/bluetooth.js`: kết nối máy in Bluetooth

## Công nghệ sử dụng

| Công nghệ | Vai trò |
| --- | --- |
| Vite 7 | Dev server và build |
| JavaScript ES Modules | Logic chính của ứng dụng |
| HTML/CSS | Giao diện |
| Capacitor 5 | Đóng gói APK Android |
| Firebase Auth + Firestore | Đồng bộ nhiều thiết bị |
| vite-plugin-pwa | Hỗ trợ PWA/offline |
| docx / ExcelJS / xlsx | Xuất Word và Excel |
| Bluetooth Serial + ESC/POS | In biên lai nhiệt |

## Cấu trúc dự án

```text
dien-nuoc-app/
|-- public/
|-- src/
|   |-- views/        # các màn hình chính
|   |-- state/        # logic dữ liệu và tính toán
|   |-- sync/         # Firebase, room sync, queue
|   |-- export/       # xuất Word / Excel
|   |-- print/        # in và xem trước biên lai
|   |-- ui/           # thành phần giao diện dùng chung
|   |-- utils/        # hàm tiện ích
|-- android/          # dự án Android qua Capacitor
|-- docs/
|   |-- images/
|   |-- screenshots/
```

## Cài đặt và chạy local

### Yêu cầu

- Node.js 18 trở lên
- npm 9 trở lên

### Cài đặt

```bash
git clone https://github.com/Duong200x/App-Web-diennuoc-.git
cd dien-nuoc-app
npm install
```

### Cấu hình môi trường

Nếu muốn dùng chức năng đồng bộ Firebase, tạo file `.env` từ `.env.example`:

```bash
copy .env.example .env
```

Điền các biến sau:

- `VITE_FB_API_KEY`
- `VITE_FB_AUTH_DOMAIN`
- `VITE_FB_PROJECT_ID`
- `VITE_FB_STORAGE_BUCKET`
- `VITE_FB_MESSAGING_SENDER_ID`
- `VITE_FB_APP_ID`

Nếu không cấu hình Firebase, app vẫn có thể chạy local để ghi số, tính tiền, sao lưu và xuất file trên một máy.

### Chạy local

```bash
npm run dev
```

Địa chỉ mặc định:

```text
http://localhost:5173
```

## Build

### Build web

```bash
npm run build
```

### Build APK Android

```bash
npm run build:apk
npx cap open android
```

## Trạng thái kiểm chứng

- Mình đã build thành công bản production local bằng `npm.cmd run build`
- Mình đã chụp ảnh README trực tiếp từ bản build local của ứng dụng
- Hiện tại script `npm test` vẫn chỉ là placeholder, chưa có test tự động thật

## Khi dùng chung Firebase project với app khác

Nếu Firebase project này còn dùng chung với app khác, đặc biệt là app game hoặc app nội bộ khác, cần nhớ:

- Firestore Rules áp dụng cho cả database, không áp dụng riêng từng repo
- namespace của app điện nước hiện dùng là `/rooms/**`
- nếu publish rules từ app khác mà không merge namespace `/rooms/**`, chức năng đồng bộ của app điện nước có thể bị chặn

Nói ngắn gọn: nếu dùng chung Firebase project, phải quản lý rules theo kiểu hợp nhất.

## Vì sao dự án này phù hợp để đưa vào portfolio intern

- Là bài toán thật, có người dùng thật
- Có tính sản phẩm rõ ràng chứ không chỉ là demo giao diện
- Có logic nghiệp vụ đáng kể
- Có xử lý offline, backup, export, print, sync
- Có cả hướng web và Android

## Hạn chế hiện tại

- Chưa có ảnh demo trên điện thoại thật trong README
- Chưa có video demo ngắn
- Chưa có test tự động cho phần tính tiền và chuyển tháng
- Một số file view còn lớn, đặc biệt là `ListView.js`
- Firebase vẫn cần cấu hình thủ công
- `SECURITY.md` hiện vẫn là file mẫu, chưa viết riêng theo dự án

## Hướng cải thiện tiếp theo

- Thêm video demo 30-60 giây
- Viết unit test cho tính tiền và rollover tháng
- Tách nhỏ các view lớn
- Bổ sung dữ liệu mẫu để người mới clone có thể demo nhanh
- Viết tài liệu riêng cho Firebase rules nếu dùng chung project

## Ghi chú

- Repo này hiện chưa có file license chính thức
- `SECURITY.md` nên được viết lại hoặc bỏ nếu không dùng

## Tác giả

Phát triển bởi [Trần Đình Dương](https://github.com/Duong200x).
