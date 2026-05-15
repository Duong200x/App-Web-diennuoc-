# Dien Nuoc App - Luong van hanh va ngu canh ky thuat

Tai lieu nay dung de AI, chatbot hoac lap trinh vien moi vao du an co the doc truoc khi sua code. Neu co thay doi hanh vi, luong xu ly, schema du lieu, sync, import/export, backup, in an hoac UI chinh, phai cap nhat file nay ngay trong cung lan sua.

## Quy tac bat buoc khi sua code

1. Doc file nay truoc khi sua.
2. Sau khi hoan tat fix/chinh sua, cap nhat lai phan luong lien quan trong file nay.
3. Khong chi them ghi chu "da fix"; phai sua mo ta luong thanh trang thai moi dung voi code hien tai.
4. Neu thay doi co anh huong den du lieu da luu trong `localStorage` hoac Firestore, ghi ro key/schema nao thay doi va cach tuong thich nguoc.
5. Neu thay doi co anh huong den tinh tien, rollover thang, no cu, tam ung, da dong, import/export, backup/restore hoac room sync, phai cap nhat cac muc tuong ung ben duoi.
6. Neu chi sua UI nho nhung khong doi luong nghiep vu, cap nhat muc "Nhat ky thay doi luong" bang mot dong ngan gon.

Quy tac render HTML:

- Moi du lieu do user nhap hoac du lieu co the den tu file import/Firestore/localStorage phai duoc escape truoc khi chen vao `innerHTML`.
- Helper hien tai: `escapeHTML()` trong `src/utils/html.js`.
- Khong chen truc tiep ten, dia chi, template, QR payload, text backup/import vao HTML string neu chua escape.

## Tong quan ung dung

Day la ung dung SPA JavaScript thuan, build bang Vite, chay tren web/PWA va dong goi APK Android bang Capacitor.

Entry point:

- `index.html` nap `src/main.js`.
- `src/main.js` khoi tao theme, PWA, rollover thang, Firebase, room subscription va router.
- `src/router.js` dieu huong bang hash route.

Thu muc chinh:

- `src/views/`: cac man hinh UI.
- `src/state/`: doc/ghi du lieu, tinh tien, lich su, backup, import.
- `src/sync/`: Firebase, room sync, queue, merge.
- `src/export/`: xuat Excel/Word.
- `src/print/`: preview va in bien lai 58mm.
- `src/ui/`: toast, loading, sync indicator, backup floating button.
- `src/utils/`: helper chung.

Thu muc sinh ra hoac khong nen xem la source chinh:

- `node_modules/`
- `dist/`
- `dev-dist/`
- `temp_edge_profile/`

## Luong khoi dong app

`src/main.js` la noi dieu phoi ban dau:

1. Import CSS va cac module side-effect:
   - `src/ui/syncIndicator.js`
   - `src/routes/backupOverlay.js`
   - `src/ui/backupFab.js`
2. Ap dung theme tu `localStorage["app-theme"]`, mac dinh `light`.
3. Neu chay native Capacitor, dong bo `StatusBar`.
4. Neu chay web, dang ky PWA service worker qua `virtual:pwa-register`.
5. Neu URL chua co hash, chuyen ve `#/list`.
6. Goi `rolloverMonth()` de tu dong chot thang neu `savedMonth` khac thang hien tai.
7. Goi `recomputePrevDebtFromHistory()` de dong bo no cu hien tai tu lich su.
8. Goi `startRouter(app)`.
9. Goi `initFirebase()`.
10. Neu dang co `roomId`, bat dau `subscribeRoom()` de nhan thay doi realtime.
11. Gan listener cho theme toggle, hamburger menu, online/offline log va loi sync room.

`window.__forceRender()` duoc gan trong `main.js`. Ham nay recompute no cu, sau do dispatch `app:force-render` de router render lai man hinh hien tai.

## Router va layout man hinh

Router nam o `src/router.js`, dung hash route:

- `#/list`: danh sach chinh.
- `#/add`: them cu dan.
- `#/history`: lich su.
- `#/config`: cau hinh gia va backup.
- `#/template`: mau phieu Word va bien lai 58mm.
- `#/room`: phong dong bo.
- `#/detail/<residentRef>`: chi tiet cu dan.
- `#/manage/<residentRef>`: quan ly/sua cu dan.

`ListView` chi mount mot lan vao `#list-host` de giu scroll, focus va filter. Cac route khac mo trong `#route-overlay`, overlay khong che topbar.

Backup view la overlay rieng, khong nam trong router chinh:

- `#/backup`
- `#/backups`

Overlay nay duoc gan boi `src/routes/backupOverlay.js`.

## Storage va schema du lieu

Tat ca key chinh nam trong `src/state/storage.js`.

Key quan trong:

- `currentReadings`: danh sach cu dan hien tai.
- `historyReadings`: lich su theo thang, dang object `{ "YYYY-MM": Resident[] }`.
- `savedMonth`: thang hien app dang lam viec.
- `electricityRate`: don gia dien.
- `waterRate`: don gia nuoc.
- `wordTemplate`: mau Word.
- `tpl58`: mau bien lai 58mm.
- `defaultDue`: han thanh toan mac dinh.
- `defaultContact`: lien he mac dinh.
- `shop_name`, `shop_addr`, `shop_phone`: thong tin in bien lai.
- `roomId`: ma phong Firestore dang tham gia.
- `historyLastImp`: moc import lich su gan nhat.

Resident sau khi normalize co cac field chinh:

```js
{
  name,
  zone,
  address,
  __order,
  oldElec,
  oldWater,
  newElec,
  newWater,
  elecDate,
  waterDate,
  isNew,
  prevDebt,
  advance,
  paid,
  paidAt,
  __elec,
  __water,
  __total,
  __advance,
  __remaining
}
```

Y nghia:

- `oldElec`, `oldWater`: chi so dau ky.
- `newElec`, `newWater`: chi so moi nhat trong ky.
- `isNew=true`: tien tinh theo `new * rate`, khong tru `old`.
- `prevDebt`: no ky truoc duoc cong vao tong.
- `advance`: so tien da thu/tam ung trong ky hien tai.
- `paid`: da dong tien. Khi `paid=true`, `remaining` tinh ra bang 0.
- `__elec`, `__water`, `__total`, `__advance`, `__remaining`: snapshot so tien tai thoi diem luu lich su/backup, dung de tranh bi thay doi khi don gia hien tai thay doi.

Key dinh danh cu dan:

- `residentKey(it)` trong `src/utils/normalize.js`.
- Dang: `slug(name)|slug(address || zone)`.
- Khi doi ten/khu/dia chi, phai can than vi key thay doi se anh huong history va Firestore doc id.

## Thiet ke muc tieu: residentId co dinh va dong bo online-first

Phan nay la luong muc tieu can chot truoc khi sua logic no/thang. Code hien tai van dang dung `residentKey` mem theo ten/khu/dia chi; khi implement migration phai cap nhat lai cac muc lien quan ben tren.

Muc tieu:

- Moi cu dan co `id` co dinh, sinh mot lan va khong doi khi sua ten/khu/dia chi.
- Firestore residents doc id dung `resident.id`, khong dung `residentKey`.
- History row luu `residentId` de lan truyen no qua cac thang khong phu thuoc ten/khu/dia chi.
- `residentKey()` chi con la fallback cho du lieu cu/import chua co `id`.
- Database la nguon chinh khi online.
- Local la cache, hang doi offline va snapshot tam; khong duoc de local cu de len database moi hon neu chua review.

Schema resident muc tieu:

```js
{
  id,
  name,
  zone,
  address,
  active,
  movedOutAt,
  oldElec,
  oldWater,
  newElec,
  newWater,
  elecDate,
  waterDate,
  isNew,
  prevDebt,
  advance,
  paid,
  paidAt,
  updatedAt,
  updatedBy,
  version,
  __order
}
```

Schema history row muc tieu:

```js
{
  residentId,
  name,
  zone,
  address,
  oldElec,
  newElec,
  oldWater,
  newWater,
  prevDebt,
  advance,
  paid,
  paidAt,
  __elec,
  __water,
  __total,
  __advance,
  __remaining,
  updatedAt,
  updatedBy,
  version
}
```

Quy tac khi tao/sua cu dan:

- Them cu dan moi phai sinh `id` truoc khi luu local/push room.
- Sua ten/khu/dia chi chi update field, khong doi `id`.
- Khong delete doc cu va tao doc moi khi rename.
- Duoc tao trung ten neu khac khu/dia chi, vi `id` la dinh danh that.
- Duplicate detection neu can chi la canh bao UX, khong phai khoa dinh danh.

Cu dan chuyen di:

- Mac dinh khong hard delete.
- Set `active=false` va `movedOutAt`.
- Danh sach hien tai an hoac loc rieng cu dan inactive.
- History van giu `residentId` va snapshot cu de tra cuu/lan truyen no neu can.
- Neu can xoa vinh vien, phai dung tombstone remote co `deleted=true`, `deletedAt`, `deletedBy`, khong chi xoa local/doc truc tiep.

Online-first startup:

```text
Neu co internet va co roomId:
1. Xac thuc Firebase.
2. Pull database hien tai truoc khi cho user thao tac.
3. Ghi database ve local cache.
4. Neu local co pending offline changes/snapshot chua dong bo, hien canh bao cho user.
5. Chi flush pending sau khi da pull database moi nhat va review/merge neu co khac biet.
6. Render app voi du lieu da dong bo.
```

Neu khong co internet:

```text
1. App duoc phep mo bang local cache/snapshot gan nhat.
2. Moi thao tac sua phai luu local va ghi pending operation/snapshot.
3. UI phai bao ro "offline - thay doi chua dong bo".
4. Khong hien thong bao thanh cong dong bo.
```

Sau moi thao tac online:

```text
1. Update local de UI phan hoi nhanh.
2. Ghi operation vao pending queue ben vung.
3. Push len Firestore ngay.
4. Push thanh cong thi xoa pending operation.
5. Push that bai do mat mang thi giu pending va snapshot.
```

Pending operation muc tieu:

```js
{
  id,
  roomId,
  type,
  residentId,
  monthKey,
  patch,
  baseRemoteVersion,
  createdAt,
  deviceId
}
```

Vi du:

```js
{ type: "resident.patch", residentId: "r_123", patch: { newElec: 120 } }
{ type: "history.patchRow", monthKey: "2026-01", residentId: "r_123", patch: { paid: true } }
{ type: "resident.create", resident: { id: "r_uuid", name, zone, address } }
```

Quy tac nut "Day snapshot offline len database":

- Khong bao gio push thang snapshot offline len database khi chua pull database hien tai.
- Luong bat buoc:

```text
Pull database hien tai -> Compare voi snapshot/pending offline -> User confirm/merge -> Push ban da chot -> Pull lai xac nhan
```

- Neu database khong doi so voi `baseRemoteVersion`, co the cho push nhanh nhung van can xac nhan.
- Neu database da doi, phai hien man review khac biet.
- Neu khac field hoac khac residentId, co the auto-merge va hien tom tat.
- Neu cung `residentId + field` hoac cung `monthKey + residentId + field`, coi la conflict va user phai chon ban database/offline/merge tay.
- Sau khi merge thay doi history cu, phai recompute/propagate chuoi no theo `residentId` truoc khi push.

Vi du conflict:

```text
Database: A.newElec = 120, A.paid = true
Snapshot offline: A.newElec = 130, A.paid = false

Man review phai hien:
- Chi so dien moi: database 120, offline 130
- Trang thai dong tien: database Da dong, offline Chua dong
```

Nguyen tac quan trong:

- Snapshot offline la ban lam viec de review/merge, khong phai lenh ghi de database.
- Backup file tai ra ngoai may la duong lui an toan cho user, khong tu dong tham gia merge neu user khong chon restore/push.
- Moi push sau offline phai co pull truoc push, giong tinh than `git pull` truoc khi `git push`.

## Tinh tien

Ham trung tam: `computeAmounts(item)` trong `src/state/readings.js`.

Quy tac hien tai:

1. Lay don gia tu `getRates()`.
2. Neu `item.isNew=true`:
   - `elecUsage = newElec`
   - `waterUsage = newWater`
3. Neu khong:
   - `elecUsage = max(0, newElec - oldElec)`
   - `waterUsage = max(0, newWater - oldWater)`
4. `elecMoney = elecUsage * electricityRate`.
5. `waterMoney = waterUsage * waterRate`.
6. `prevDebt = max(0, item.prevDebt)`.
7. `total = elecMoney + waterMoney + prevDebt`.
8. `advance = max(0, item.advance)`.
9. Neu `paid=true`, `remaining = 0`.
10. Neu `paid=false`, `remaining = max(total - advance, 0)`.

Luu y quan trong:

- `computeAmounts()` khong lam tron tong.
- UI/export co noi lam tron nghin bang `roundK()`.
- Khi sua logic tinh tien, phai kiem tra ListView, DetailView, HistoryView, export Excel, export Word va receipt print vi tat ca deu dua vao `computeAmounts()` hoac snapshot `__*`.

## CRUD cu dan hien tai

File chinh: `src/state/readings.js`.

Ham chinh:

- `listResidents()`: doc `currentReadings`, normalize tung row.
- `saveResidents(arr)`: normalize va luu lai, gan `__order`.
- `addResident()`: them cu dan, set ngay hien tai, detect `isNew`.
- `updateInline()`: sua nhanh chi so moi, rang buoc `new >= old`.
- `updateFull()`: sua day du co rang buoc `new >= old`.
- `updateFullAdmin()`: sua day du bo rang buoc `new >= old`, dung trong man Quan ly.
- `addAdvance()`: cong tam ung, clamp khong vuot `total`, neu du thi set `paid=true`.
- `setPaid()`: chi doi trang thai paid/paidAt, khong tu sua `advance`.
- `setPrevDebt()`: sua no cu.
- `removeResident()`: xoa local va tra ve ban ghi da xoa de caller sync.

Man hinh lien quan:

- `FormView`: them cu dan, neu dang o room thi `pushOneResident()`.
- `ListView`: sua nhanh chi so, thu/sua tam ung, mark paid, import danh sach, export.
- `ManageView`: sua day du, doi key, rename history, xoa cu dan, sync delete.
- `DetailView`: xem chi tiet, export Word ca nhan, mo preview in.

## Luong danh sach hien tai

File: `src/views/ListView.js`.

Khi mount:

1. Goi `recomputePrevDebtFromHistory()`.
2. Doc `listResidents()`.
3. Render toolbar, filter, tong tien, tong theo khu va bang cu dan.
4. Giu state UI trong `sessionStorage["list.ui"]`.

Filter:

- Tim theo ten khong dau.
- Loc khu: `tren`, `giua`, `duoi`, `khac`.
- Loc thanh toan: all/paid/unpaid.
- Khu co the lay truc tiep tu `zone`, hoac suy luan fuzzy tu `address`.

Tong tien:

- Tong dien, tong nuoc, tong no cu.
- Tong cong co toggle tinh/khong tinh no cu.
- Tong theo khu tinh tren cac row sau filter.

Hanh dong trong bang:

- Mark paid: `setPaid()`, sau do neu in room thi `pushOneResident()`.
- Thu tam ung: `addAdvance()`.
- Sua so da thu: `updateFull({ advance, paid })`.
- Chinh sua nhanh chi so: `updateInline()`.
- Quan ly: route `#/manage/<residentKey>`.
- Chi tiet: route `#/detail/<residentKey>`.

Auto-refresh:

- ListView poll `listResidents()` moi khoang 650ms.
- Neu dang focus input trong table thi tam dung refresh de tranh mat focus.

## Chuyen thang va lich su

File chinh: `src/state/history.js` va mot phan trong `src/state/readings.js`.

`rolloverMonth()`:

1. Doc `savedMonth` va `getCurrentMonth()`.
2. Neu bang nhau thi khong lam gi.
3. Neu khac va co du lieu current:
   - Neu `history[savedMonth]` chua co, luu snapshot thang cu.
   - Tao bang thang moi:
     - `oldElec = newElec`
     - `oldWater = newWater`
     - `newElec = oldElec`
     - `newWater = oldWater`
     - `prevDebt = paid ? 0 : roundK(remaining)`
     - `advance = 0`
     - `paid = false`
     - `paidAt = ""`
     - ngay ghi rong
     - `isNew = false`
   - Luu `savedMonth = currentMonth`.
4. Neu dang o room, push history/current/month.

`forceCarryOverToCurrentMonth()`:

- Dung cho nut "Sua thang (reset)" trong ListView.
- Ghi de snapshot hien tai vao lich su thang truoc.
- Reset bang thang hien tai theo quy tac no = phan con thieu cua thang truoc.

`importHistoryMonth(monthKey, rows)`:

- Luu rows vao `history[monthKey]` co snapshot `__*`.
- Neu import thang lien truoc thang hien tai, cap nhat current:
  - `oldElec/oldWater = newElec/newWater` cua lich su.
  - `prevDebt = paid ? 0 : roundK(remaining)`.
- Co marker de tranh ap lai trung lap.

`recomputePrevDebtFromHistory()`:

- Doc history cac thang `<= currentMonth`.
- Voi moi cu dan hien tai, lay ban ghi lich su gan nhat theo `residentKey`.
- Neu ban ghi gan nhat da paid thi `prevDebt = 0`, nguoc lai lay `roundK(__remaining)`.
- Luu lai `currentReadings`.

`updateHistoryRow(monthKey, idx, patch)`:

- Dung khi sua paid trong HistoryView.
- Rebuild snapshot cua row.
- Goi `propagateDebtUpdates()` de lan truyen no sang cac thang sau neu co.
- Goi `recomputePrevDebtFromHistory()` de cap nhat current.

## Luong lich su UI

File: `src/views/HistoryView.js`.

Chuc nang:

- Hien tat ca thang trong `historyReadings`.
- Loc theo nam/thang.
- Tim trong tung thang.
- Sua paid tung row va bam Luu.
- Xoa ca bang thang.
- Xuat Excel tung thang.
- Import Excel/CSV vao history.

Khi sua paid hoac xoa/import:

1. Cap nhat `historyReadings`.
2. Goi `recomputePrevDebtFromHistory()`.
3. Neu dang o room, push history va current.
4. Render lai UI.

Auto-refresh lich su:

- `HistoryView` co vong polling de phat hien `historyReadings` thay doi do sync tu thiet bi khac.
- Vong polling phai tu dung khi element mount cua HistoryView khong con trong DOM (`el.isConnected === false`) de tranh nhieu vong cu tiep tuc chay sau khi dong overlay/mo lai lich su.

Import history:

- Excel parser o `src/state/xlsxImport.js`.
- CSV fallback cung trong file nay.
- Khong cho import thang tuong lai.
- Neu file khong co thang thi nguoi dung phai nhap `YYYY-MM`.

## Import danh sach hien tai

File: `src/state/importResidents.js`.

`importResidentsFromXlsxToCurrent(file)`:

1. Doc workbook bang `xlsx`.
2. Tim sheet/header tot nhat.
3. Nhan dang cot ten, dia chi/khu, dien/nuoc cu moi, no, tam ung, paid.
4. Bo cac dong tong/khu.
5. Merge vao `currentReadings` theo `residentKey`:
   - Neu da co thi update.
   - Neu chua co thi add moi.
6. Set `savedMonth = getCurrentMonth()`.

ListView sau import:

- Neu dang o room, push tung resident len Firestore.
- Render lai danh sach.

## Backup va restore

File chinh: `src/state/backup.js`.

Snapshot gom:

- `_v`
- `createdAt`
- `month`
- `current`
- `history`
- `electricityRate`
- `waterRate`
- `template`
- `template58`
- `due`
- `contact`
- `shop_name`
- `shop_addr`
- `shop_phone`
- `roomId`
- `meta`

Backup ra file:

- `downloadBackup()` tao JSON va goi `saveTextSmart()`.
- Day la ban backup that su de nguoi dung tai/luu ra tep ben ngoai may.
- Khong nham voi snapshot local xoay vong trong `localStorage`; snapshot local chi la ban tam thoi de co the khoi phuc nhanh hoac cho den khi co mang/tac vu tiep theo.

Restore:

- `restoreFromJsonText(text)` parse JSON.
- Bat buoc co `current` va `history`.
- Ghi lai current/history/month/rates/templates/shop info.
- Hien tai khong restore `roomId` tu file backup.

Backup local xoay vong:

- Prefix key: `BACKUP_HISTORY_`.
- Index: `BACKUP_INDEX`.
- Latest: `BACKUP_LATEST`.
- Mac dinh giu 3 ban.
- Day la snapshot tam trong trinh duyet/ung dung, khong phai tep backup da tai ra Documents/Downloads.

UI backup:

- `ConfigView` co nut backup/restore nhanh.
- `backupview.js` quan ly danh sach backup local.
- `backupOverlay.js` mo view qua `#/backup` hoac `#/backups`.
- `backupFab.js` tao nut noi keo-tha de mo backup.

Neu restore va chon "restore + dong bo":

1. Restore local truoc.
2. Neu co room va online, push current/history/month len room.
3. Reload app.

Roi phong sync:

- `RoomView` phai canh bao ro rang vi `leaveRoom()` se xoa `current`, `history` va `month` local cua may hien tai.
- Truoc khi roi phong, UI hoi nguoi dung co muon tai backup JSON ra tep hay khong.
- Du lieu tren Firestore room khong bi xoa khi nguoi dung roi phong.

## Firebase room sync

File chinh:

- `src/sync/firebase.js`
- `src/sync/room.js`
- `src/sync/pushQueue.js`
- `src/sync/safeMerge.js`

Firebase init:

- Config lay tu bien moi truong `VITE_FB_*`.
- Firestore bat IndexedDB persistence, uu tien multi-tab.
- Auth dung email co dinh `quanly@diennuoc.com`, mat khau nhap qua prompt.
- Neu user huy prompt mat khau, `ensureAuth()` reject va toan bo tac vu lien quan den room phai dung lai. Khong duoc tiep tuc push/join/create/delete room trong trang thai chua xac thuc.

Room structure tren Firestore:

```text
rooms/{roomId}
rooms/{roomId}/residents/{residentKey}
rooms/{roomId}/history/all
rooms/{roomId}/meta/state
```

Public API chinh trong `room.js`:

- `createRoom()`
- `joinRoom(roomId)`
- `enterRoom(roomId, onRemoteChange)`
- `leaveRoom()`
- `subscribeRoom(onRemoteChange)`
- `pushOneResident(it)`
- `pushAllToRoom()`
- `pushDeleteResident(it)`
- `pushHistoryAll()`
- `pushMonthPtr()`

Push queue:

- Moi push chay qua `pushQueue`.
- Queue coalesce theo key, chay tuan tu, retry khi loi, pause khi offline.
- `syncIndicator.js` doc trang thai queue de hien chip dong bo.

Residents sync:

- Doc id la `residentKey`.
- Remote `_deleted` bi bo qua.
- Local deleted set `__deleted_keys` giup tranh keo nguoi da xoa quay lai.
- Khi onSnapshot, merge current local voi remote, dedupe theo residentKey, uu tien row co `updatedAt` moi hon.

History sync:

- History luu mot doc `history/all`.
- Co local touch key `__history_updated_at` de tranh remote cu de len local vua sua.
- Co base key `__last_synced_history` de merge 3 chieu.
- `mergeHistoryObjects(base, local, remote)` uu tien giu du lieu an toan:
  - `paid`: OR.
  - `advance`, `prevDebt`, snapshot tien: max.
  - chi so cong to: max.
  - string: uu tien local neu co.

Leave room:

- Huy listener.
- Xoa `roomId`.
- Xoa current/history/month local.
- Xoa deleted set, last synced history va history touch.
- UI phai thong bao ro rang truoc khi goi ham nay, vi day khong chi la "ngat dong bo" ma con lam sach du lieu local cua phong tren may hien tai.

## Xuat Excel

File: `src/export/excel.js`.

`exportExcel(items, monthKey)`:

- Neu co `monthKey` dang `YYYY-MM`, dung thang do cho title/header.
- Neu khong, dung `getCurrentMonth()`.
- Tao workbook ExcelJS.
- Cot gom ten, dia chi/khu, chi so dien/nuoc thang truoc va thang nay, usage, tien, no ky truoc, tong cong da lam tron, paid Y/N.
- Co tong chinh va bang "Tong theo khu".
- Neu ExcelJS loi khi ghi, fallback xuat CSV.

## Xuat Word

File:

- `src/export/wordDocx.js`
- `src/export/word.js`

`wordDocx.js`:

- Tao `.docx` bang thu vien `docx`.
- Dung `computeAmounts()`.
- Tong tien hien la tong da lam tron nghin.
- Neu tao `.docx` loi, fallback sang `.doc` HTML trong `word.js`.

`word.js`:

- Tao HTML Word `.doc`.
- Dung template Word tu `wordTemplate`.
- Neu template cu thieu `{{NO_KY_TRUOC}}`, tu chen dong no ky truoc.

## In bien lai 58mm

File:

- `src/print/preview.js`
- `src/print/receipt.js`
- `src/print/template.js`
- `src/print/escpos.js`
- `src/print/bluetooth.js`
- `src/print/qrDecode.js`

Luong tu DetailView:

1. `DetailView` tao `shop`, `resident`, `bill`.
2. Goi `openReceiptPreview({ shop, resident, bill })`.
3. Preview build data bang `buildReceiptData()`.
4. Template lay bang `loadTemplate()`.
5. Web: bam "In trinh duyet" se in qua iframe.
6. APK: bam "In Bluetooth" se goi `printReceiptWithOptions()`.

Receipt data:

- Tien dien, tien nuoc, no, tam ung, tong, con thieu duoc build san.
- Template chi render token, khong tu tinh lai nghiep vu.
- `NO_KY_TRUOC` va `KHOAN_NO` la so raw de template doc no.
- `TAM_UNG`, `CON_THIEU` la chuoi tien da format.
- `ADVANCE_RAW`, `REMAIN_RAW` dung de quyet dinh chen dong dong.

Template 58mm:

- Luu o `tpl58`.
- Co cu phap:
  - `@C`, `@L`, `@R`: can le.
  - `@B`, `@/B`: bold.
  - `@D`, `@/D`: double size.
  - `@FA`, `@FB`: font ESC/POS.
  - `@SZ2x1`...: size.
  - `@HR`, `@HR2`: ke ngang.
  - `Label|Value`: can trai-phai theo so cot.

Bluetooth:

- Chi hoat dong trong APK co `window.bluetoothSerial`.
- Xin quyen Android Bluetooth/location.
- Uu tien may in da luu `printer-address`.
- Neu chua co, list may da pair va chon may in.
- Ghi bytes theo chunk 256.

QR:

- Preview co the chon anh QR, decode bang `jsqr`.
- Payload luu localStorage de lan sau dung lai.
- Khi in APK, QR duoc in bang lenh ESC/POS `GS ( k`.

## Save file tren web va APK

File: `src/utils/save.js`.

Web:

- Tao Blob va click anchor download.

APK:

- Dung Capacitor Filesystem.
- Neu co Share plugin, ghi tam vao Cache, mo Share, neu nguoi dung khong dismissed thi move sang Documents/DienNuoc.
- Neu khong co Share plugin, hoi confirm roi ghi vao Documents/DienNuoc.

Vite build APK alias `@capacitor/share` sang shim trong `src/shims/capacitor-share.js`, nen code khong import Share truc tiep.

## Android va build

Scripts trong `package.json`:

- `npm run dev`: Vite dev server.
- `npm run build`: build web.
- `npm run build:apk`: `vite build --mode apk && npx cap sync android`.
- `npm run preview`: preview build.

`vite.config.js`:

- Mode `apk`:
  - `base: "./"`.
  - Tat PWA plugin.
  - Alias `virtual:pwa-register` sang `src/pwa-shim.js`.
  - Alias `@capacitor/share` sang shim.
- Web:
  - Bat `vite-plugin-pwa`.

Android:

- App id: `vn.dio.diennuoc`.
- MainActivity la `BridgeActivity`.
- AndroidManifest co quyen Internet, Bluetooth, location va storage cu.
- Capacitor webDir la `dist`.

## Cac diem de gay loi khi sua

- Dinh danh cu dan hien tai:
  - `id`/`residentId` la dinh danh chinh va phai giu nguyen khi doi ten, doi khu, doi dia chi.
  - `residentKey(name|address/zone)` chi la fallback cho du lieu cu, backup cu va import cu.
  - Khi mo app, `ensureResidentIds()` se migration mem local current/history: them `id/residentId` cho ban ghi cu, khong xoa du lieu cu.
  - History, route detail/manage, recompute no va sync room phai uu tien `residentIdentity()` thay vi match truc tiep bang ten/khu.
- Firestore residents doc moi dung `residentIdentity()` lam doc id. Doc cu theo `residentKey` van doc duoc; khong hard-delete doc cu tu dong khi rename vi co the gay mat du lieu neu nhieu user dang sync.
- Doi `residentKey` se anh huong fallback legacy, import cu va dedupe; khong duoc bien no lai thanh nguon dinh danh chinh.
- Khi app mo va dang o trong room, neu co mang thi main se tao backup local truoc, sau do `pullRoomToLocal()` de tai current/history/month tren database ve local truoc khi rollover/render. Neu auth bi huy hoac pull loi thi chi fallback local, khong crash.
- Snapshot offline trong man hinh backup khong duoc push thang len room. Nut dong bo snapshot phai theo luong:
  1. Pull database hien tai bang `fetchRoomSnapshot()`.
  2. Hien so sanh snapshot local/offline voi database.
  3. Neu user xac nhan, merge current theo `residentIdentity()` va merge history bang `mergeHistoryObjects()`.
  4. Restore ban da merge vao local, chay migration id, roi moi `pushAllToRoom()` / `pushHistoryAll()` / `pushMonthPtr()`.
  5. Neu user huy confirm thi khong thay doi local/remote.
- Sua `computeAmounts()` se anh huong UI, history snapshot, Excel, Word va receipt.
- Sua logic `paid`/`advance` can giu quy tac: `paid=true` lam `remaining=0`, khong tu sua advance tru khi UI chu dong set.
- Sua `prevDebt` can can than voi vong recompute tu history. Hien tai `recomputePrevDebtFromHistory()` coi lich su gan nhat la nguon chinh va co the ghi de no cu trong current.
- Sua rollover/import history can tranh cong don no nhieu lan.
- Luong no da chot:
  - Moi thang chi mang sang `remaining` cua thang lien truoc, khong cong lai ca chuoi cu.
  - `remaining = tien dien + tien nuoc + prevDebt - advance`, rieng `paid=true` thi `remaining=0`.
  - Khi tick `paid` trong history, snapshot coi nhu thu du: `__advance = __total`, `__remaining = 0`.
  - Khi huy tick `paid` trong history va lan tick truoc da tu set thu du, advance duoc tra ve 0 de no hien lai dung.
  - Sua/import snapshot thang cu phai goi lan truyen no sang cac thang sau theo `residentId`, roi moi recompute `prevDebt` cua current tu thang gan nhat.
  - Tien tam ung truoc khi chuyen thang chi tru vao ky vua ket thuc; thang moi nhan `prevDebt = remaining` sau khi tru tam ung va reset `advance=0`.
- Sua history can cap nhat current bang `recomputePrevDebtFromHistory()`.
- Sua sync can can than voi remote rong khong duoc de len local co du lieu.
- Xoa cu dan trong room can push delete va cap nhat local deleted set.
- Import Excel co nhieu layout, parser dang dung heuristic; khong nen thay bang mapping cung neu chua co yeu cau.
- In 58mm can giu text khong dau de hop may in nhiet.
- APK khong dung PWA service worker.

## Nhat ky thay doi luong

- 2026-05-14: Tao tai lieu mo ta luong tong the cua du an va them quy tac bat buoc cap nhat file nay sau moi lan sua code.
- 2026-05-14: Them canh bao/backup truoc khi roi room, huy toan bo tac vu room khi user huy mat khau sync, them helper escape HTML va cap nhat cac man hinh chinh de tranh vo UI/injection khi render du lieu user.
- 2026-05-14: Them guard cho vong auto-refresh cua HistoryView de dung polling khi overlay lich su da bi thao khoi DOM.
- 2026-05-14: Bo sung thiet ke muc tieu cho `residentId` co dinh, online-first sync va luong day snapshot offline theo quy tac pull-compare-confirm-push.
- 2026-05-14: Cai dat buoc nen `residentId` co dinh: migration mem current/history khi khoi dong, route detail/manage theo `residentIdentity`, history/recompute/import/sync room uu tien `id/residentId`, Firestore doc moi dung identity moi nhung van doc duoc doc/backup cu theo `residentKey`.
- 2026-05-14: Doi nut dong bo snapshot backup sang luong pull-compare-confirm-push: tai room snapshot truoc khi day, so sanh so luong, merge current/history theo identity roi moi push len database; `safeMerge` history cung chuyen sang `residentIdentity`.
- 2026-05-14: Them online-first pull khi khoi dong app trong room: luu snapshot local truoc, pull database ve local bang `pullRoomToLocal()`, roi moi chay rollover/render; them API `fetchRoomSnapshot()` / `pullRoomToLocal()` trong sync room.
- 2026-05-14: Sau restore JSON trong ConfigView va sau import Excel trong ListView, chay `ensureResidentIds()` ngay de du lieu moi/du lieu cu co `id/residentId` truoc khi reload, render hoac sync.
- 2026-05-14: Fix luong no history/current: helper tinh `carryRemaining`, snapshot history tinh lai `__total/__advance/__remaining` nhat quan, tick paid history set thu du va remaining 0, huy tick tra advance ve 0 neu truoc do tu thu du, sua/import thang cu lan truyen no qua cac thang sau bang `residentId`.
- 2026-05-15: Dong bo dropdown o History/Form/Manage sang custom select giong ListView de tranh native select bi sai mau trong Android WebView va dam bao dark theme dung mau.

## Rule.md

Noi dung duoi day duoc copy tu `Rule.md` va la rule markdown bat buoc doc cung voi tai lieu luong nay.

```md
Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

Tradeoff: These guidelines bias toward caution over speed. For trivial tasks, use judgment.

1. Think Before Coding
Don't assume. Don't hide confusion. Surface tradeoffs.

Before implementing:

State your assumptions explicitly. If uncertain, ask.
If multiple interpretations exist, present them - don't pick silently.
If a simpler approach exists, say so. Push back when warranted.
If something is unclear, stop. Name what's confusing. Ask.
2. Simplicity First
Minimum code that solves the problem. Nothing speculative.

No features beyond what was asked.
No abstractions for single-use code.
No "flexibility" or "configurability" that wasn't requested.
No error handling for impossible scenarios.
If you write 200 lines and it could be 50, rewrite it.
Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

3. Surgical Changes
Touch only what you must. Clean up only your own mess.

When editing existing code:

Don't "improve" adjacent code, comments, or formatting.
Don't refactor things that aren't broken.
Match existing style, even if you'd do it differently.
If you notice unrelated dead code, mention it - don't delete it.
When your changes create orphans:

Remove imports/variables/functions that YOUR changes made unused.
Don't remove pre-existing dead code unless asked.
The test: Every changed line should trace directly to the user's request.

4. Goal-Driven Execution
Define success criteria. Loop until verified.

Transform tasks into verifiable goals:

"Add validation" â†’ "Write tests for invalid inputs, then make them pass"
"Fix the bug" â†’ "Write a test that reproduces it, then make it pass"
"Refactor X" â†’ "Ensure tests pass before and after"
For multi-step tasks, state a brief plan:

1. [Step] â†’ verify: [check]
2. [Step] â†’ verify: [check]
3. [Step] â†’ verify: [check]
Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.
```
