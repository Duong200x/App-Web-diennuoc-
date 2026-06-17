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
6. Hien `#boot-screen` trong `index.html` ngay tu dau de tranh man hinh trang khi doc database cham.
7. Goi `ensureResidentIds()` de migration mem id cho current/history local.
8. Neu dang co `roomId` va online, tao backup local nho truoc, roi `pullRoomToLocal()` de lay database ve local, merge pending va day pending truoc khi an boot loading. Neu pull/push loi thi fallback local va giu pending.
9. Goi `rolloverMonth()` de tu dong chot thang neu `savedMonth` khac thang hien tai.
10. Goi `recomputePrevDebtFromHistory()` de dong bo no cu hien tai tu lich su.
11. Goi `startRouter(app)` mot lan duy nhat, sau do an `#boot-screen`.
12. Goi `initFirebase()`.
13. Neu dang co `roomId`, bat dau `subscribeRoom()` de nhan thay doi realtime.
14. Gan listener cho theme toggle, hamburger menu, online/offline log va loi sync room.

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
1. Hien man hinh boot loading de user biet app dang doc du lieu.
2. Goi `ensureAuth()`: neu Firebase auth session con thi chay thang, neu chua co session thi hoi mat khau mot lan.
3. Tao backup local nho truoc khi pull.
4. Pull database hien tai bang `pullRoomToLocal()` va merge voi local pending.
5. Day lai local pending bang `pushPendingRoomChanges()`.
6. Bat realtime `subscribeRoom()`.
7. An boot loading va hien trang thai "Da dong bo".
```

Neu khong co internet:

```text
1. App duoc phep mo bang local cache/snapshot gan nhat.
2. Moi thao tac sua phai luu local va gan pending (`__pendingSync` cho resident, `__history_pending_sync` cho history).
3. Khong cho push treo UI; push offline chi enqueue/giu pending roi tra ve.
4. Khi co mang lai, app tu pull database truoc, merge pending, roi moi push pending.
```

Sau moi thao tac online:

```text
1. Update local de UI phan hoi nhanh.
2. Gan pending local.
3. Neu app dang visible va online thi push len Firestore ngay.
4. Neu offline/an app/push loi thi giu pending; user co the bam "Day lai du lieu" trong RoomView.
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
- `addResident()`: them cu dan, set ngay hien tai, detect `isNew`, gan `updatedAt` va `__pendingSync`.
- `updateInline()`: sua nhanh chi so moi, rang buoc `new >= old`, gan `updatedAt` va `__pendingSync`.
- `updateFull()`: sua day du co rang buoc `new >= old`, gan `updatedAt` va `__pendingSync`.
- `updateFullAdmin()`: sua day du bo rang buoc `new >= old`, dung trong man Quan ly, gan `updatedAt` va `__pendingSync`.
- `addAdvance()`: cong tam ung, clamp khong vuot `total`, neu du thi set `paid=true`, gan `updatedAt` va `__pendingSync`.
- `setPaid()`: chi doi trang thai paid/paidAt, khong tu sua `advance`, gan `updatedAt` va `__pendingSync`.
- `setPrevDebt()`: sua no cu, gan `updatedAt` va `__pendingSync`.
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

- Mark paid: `setPaid()`, render local ngay, sau do neu in room thi `pushOneResident()` chay nen.
- Thu tam ung: `addAdvance()`, render local ngay, sau do neu in room thi `pushOneResident()` chay nen.
- Sua so da thu: `updateFull({ advance, paid })`, render local ngay, sau do neu in room thi `pushOneResident()` chay nen.
- Chinh sua nhanh chi so: `updateInline()`, render local ngay, sau do neu in room thi `pushOneResident()` chay nen.
- Neu push nen loi, UI giu du lieu tren may va toast "Da luu tren may, chua dong bo database". Khong rollback local tu dong.
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
- `ensureAuth()` dung Firebase Auth voi email noi bo `quanly@diennuoc.com`.
- Neu Firebase da co `auth.currentUser` tu lan dang nhap truoc thi sync/tai room/push room khong hoi lai mat khau.
- Neu chua co auth session (lan dau vao phong, xoa app data, mat session, may moi) thi prompt mat khau mot lan. User huy prompt thi tac vu room dung lai, app fallback local va giu pending.

Room structure tren Firestore:

```text
rooms/{roomId}
rooms/{roomId}/residents/{residentIdentity}
rooms/{roomId}/history/all
rooms/{roomId}/meta/state
```

Public API chinh trong `room.js`:

- `createRoom()`
- `joinRoom(roomId)`
- `enterRoom(roomId, onRemoteChange)`
- `leaveRoom()`
- `subscribeRoom(onRemoteChange)`
- `disconnectRoomRuntime()`
- `pushOneResident(it)`
- `pushAllToRoom()`
- `pushDeleteResident(it)`
- `pushHistoryAll()`
- `pushMonthPtr()`
- `pushPendingRoomChanges()`
- `hasPendingRoomChanges()`

Push queue:

- Moi push chay qua `pushQueue`.
- Queue coalesce theo key, chay tuan tu, retry khi loi, pause khi offline.
- Khi app hidden/offline, push chi enqueue/giu pending va khong doi `drain()` de tranh treo UI.
- Queue khong tu resume push khi online/visible. `main.js` phai `pullRoomToLocal()` truoc, sau do moi `pushQueue.resume()` va `pushPendingRoomChanges()`.
- `syncIndicator.js` doc trang thai queue de hien chip dong bo.

Residents sync:

- Doc id moi la `residentIdentity()` (`id/residentId` neu co, fallback `residentKey` cho du lieu cu).
- Remote `_deleted` bi bo qua.
- Local deleted set `__deleted_keys` giup tranh keo nguoi da xoa quay lai.
- Moi sua resident local trong `src/state/readings.js` phai gan `updatedAt` va `__pendingSync=true`.
- `__pendingSync` chi la co local, khong day len Firestore.
- Khi `pushOneResident()`/`pushAllToRoom()` thanh cong, xoa `__pendingSync` cho row do neu local khong co ban sua moi hon.
- Khi onSnapshot hoac `pullRoomToLocal()`, merge current local voi remote theo `residentIdentity()`: row local dang `__pendingSync` duoc giu lai, remote chi de len row local khi local khong pending va `updatedAt` remote moi hon hoac bang.
- `pushPendingRoomChanges()` day cac resident dang `__pendingSync`, sau do day history pending neu co, roi day month pointer.

History sync:

- History luu mot doc `history/all`.
- Co local touch key `__history_updated_at` de tranh remote cu de len local vua sua.
- Co local pending key `__history_pending_sync`; moi `setJSON(KEYS.history, ...)` danh dau history can dong bo.
- Co base key `__last_synced_history` de merge 3 chieu.
- Khi `pullRoomToLocal()`, neu history local dang pending thi merge local + remote bang `mergeHistoryObjects()` va giu pending de push lai. Neu local khong pending thi history remote co du lieu se thay history local; neu remote rong va local co du lieu thi giu local.
- Khi history remote/onSnapshot duoc ap vao local, code phai clear `__history_pending_sync` neu thay doi do remote, khong phai do user sua local.
- `mergeHistoryObjects(base, local, remote)` uu tien giu du lieu an toan:
  - `paid`: OR.
  - `advance`, `prevDebt`, snapshot tien: max.
  - chi so cong to: max.
  - string: uu tien local neu co.

Runtime room reconnect:

- `roomId` van luu trong localStorage de lan sau mo app tu dong noi lai, khong bat user nhap ma phong lai.
- Khi app hidden/pause, goi `disconnectRoomRuntime()`: huy realtime listener va pause queue, nhung khong xoa `roomId`, khong xoa current/history/month.
- Khi app visible/focus/online lai, `main.js` goi luong sync trung tam: backup local nho, `pullRoomToLocal()`, recompute, `pushPendingRoomChanges()`, roi `subscribeRoom()`.
- Luong nay dam bao co mang thi pull database truoc roi moi push pending, giong nguyen tac pull truoc push.

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
- Khi app mo va dang o trong room, neu co mang thi main se tao backup local truoc, sau do `pullRoomToLocal()` de tai current/history/month tren database ve local, merge pending va `pushPendingRoomChanges()` truoc khi an boot loading. Neu pull/push loi thi fallback local, giu pending va khong crash.
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
- 2026-06-09: Them boot loading khi khoi dong de tranh man hinh trang luc doc database; chuyen mark paid/thu tam ung/sua so da thu/sua chi so nhanh sang local-first roi push nen; them `updatedAt` + `__pendingSync` cho resident local va merge room/pull khong cho remote cu de len row local dang cho dong bo.
- 2026-06-09: Doi luong room noi bo thanh hoi mat khau mot lan khi chua co Firebase auth session, cac lan sau sync tu dong neu session con; app hidden thi pause runtime sync nhung giu `roomId`; khi mo/online lai tu pull database truoc, merge pending, roi moi push pending; them `__history_pending_sync`, `pushPendingRoomChanges()`, nut RoomView "Dong bo phong" va "Day lai du lieu".
- 2026-06-09: Sửa loi treo dong bo (deadlock queue) bang cach await item.promise va reject ngay khi loi mang lan dau; fix loi mat du lieu local do snapshot merge bang cach them `isSynced: true` cho remote rows va chi cho phep xoa resident neu da tung duoc sync thanh cong; tu dong sync khi co mang lai qua window online event.
- 2026-06-09: Sua loi mat du lieu khi thu tam ung va mat no cu do dong bo lech pha luc rollover: chan downgrade month pointer va chan merge du lieu residents tu remote thang cu len local thang moi trong `subscribeRoom` va `pullRoomToLocal`; cap nhat `updatedAt` moi va cờ `__pendingSync` trong `rolloverMonth`, `forceCarryOverToCurrentMonth`, `importHistoryMonth` va `recomputePrevDebtFromHistory`.

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

## Nhật ký sửa lỗi (Fixes)
- **Fix lỗi: Sửa Nợ cũ (prevDebt) ở ManageView bị khôi phục lại khi load list.**
  - **Lý do**: Hàm `recomputePrevDebtFromHistory` (chạy mỗi khi `ListView` mount) quét lịch sử và tự động tính lại nợ đè lên dữ liệu tạm thời.
  - **Cách sửa**: 
    1. Trong `readings.js`, thêm `overrideLatestHistoryRemaining(resident, newDebt)` để tìm bản ghi lịch sử tháng gần nhất và sửa trực tiếp `__remaining` = `newDebt` (đồng thời tắt `paid` nếu nợ > 0).
    2. Trong `ManageView.js`, thu thập biến `historyChanged`. Nếu `isInRoom()`, gọi thêm `pushHistoryAll()` để đẩy lịch sử vừa sửa lên Firebase, giúp nợ mới sửa được lưu vĩnh viễn và đồng bộ.

- **Fix lỗi: Kẹt số Tạm ứng khi huỷ tick Đã đóng và Race Condition đồng bộ lịch sử.**
  - **Lý do**: Khi huỷ tick Đã đóng ở `ManageView.js`, ô tạm ứng không bị reset, làm `advance = total` dẫn đến nợ báo sai. Trong `room.js`, đẩy toàn bộ file lịch sử bằng `setDoc` dễ gây đè/mất dữ liệu nếu 2 thiết bị cùng bấm Lưu (Race Condition).
  - **Cách sửa**:
    1. Bổ sung sự kiện thay đổi của checkbox `Đã đóng` trong `ManageView.js`, tự động reset `#advance.value = ""` nếu unchecked.
    2. Import `runTransaction` từ Firebase. Viết lại hàm `_pushHistoryAllRaw` trong `room.js` để dùng Transaction (Atomical update). Gộp (merge) an toàn 3 chiều bản lịch sử cũ ở local, bản remote đang có và bản local mới bằng `mergeHistoryObjects` trước khi push.

- **Fix lỗi: Treo app màn hình trắng (loading) khi rớt mạng cục bộ (có WiFi, mất Internet).**
  - **Lý do**: `fetchRoomSnapshot` không có cơ chế Timeout, chờ Firebase phản hồi vô tận.
  - **Cách sửa**: Bọc hàm `syncRoomOnline({ boot: true })` trong `main.js` với `waitForBootPull(promise, 3000)`. Quá 3 giây sẽ từ chối kết nối mạng và cho phép app vào thẳng bằng dữ liệu Offline (Local Storage).

- **Kiến trúc: Băm nhỏ lịch sử (Data Sharding) để tối ưu băng thông và tốc độ tải.**
  - **Lý do**: File JSON lịch sử `history/all` phình to lên 24 tháng, dung lượng quá nặng khiến mỗi lần sửa/đồng bộ bị nghẽn băng thông.
  - **Cách sửa**:
    1. Giữ nguyên bộ nhớ đệm Offline là 1 file JSON thống nhất (`KEYS.history`) để duy trì độ trễ 0ms cho mọi tác vụ tra cứu, in ấn, tính tiền cũ.
    2. Trong `room.js`, viết lại hàm `_pushHistoryAllRaw`. Sử dụng thuật toán Diffing: Chỉ so sánh và đẩy mảng lịch sử của **những tháng bị thay đổi** lên thư mục `history_v2/{month}` trên Firebase bằng Transaction. Tiết kiệm tối đa băng thông.
    3. Trong `fetchRoomSnapshot` (luồng kéo dữ liệu), thiết lập Fallback: Tải "Bản nền" `history/all` phiên bản cũ và đắp thêm các "Mảnh vỡ" tải từ `history_v2` để ráp lại bản hoàn chỉnh. Tương thích chéo 100% với hệ thống cũ.

- **Fix lỗi: File Excel CSV (Fallback) bị hỏng font Tiếng Việt trên máy tính Windows.**
  - **Lý do**: Nếu thư viện ExcelJS thất bại (do thiết bị cũ/lỗi trình duyệt), app sẽ tự động "chữa cháy" xuất file `.csv`. Tuy nhiên file `.csv` chuẩn UTF-8 lại không được Microsoft Excel trên Windows nhận dạng đúng, gây biến dạng chữ Tiếng Việt.
  - **Cách sửa**: Chèn thêm ký tự BOM vô hình `\uFEFF` vào đầu chuỗi nội dung CSV trong `src/export/excel.js` trước khi xuất file để ép Microsoft Excel luôn đọc dưới chuẩn Unicode UTF-8.
