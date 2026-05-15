// src/sync/safeMerge.js
import { residentIdentity } from "../utils/normalize.js";
//
// Hợp nhất 3-chiều lịch sử dạng Object:
//   { "YYYY-MM": [ rows... ], ... }
//
// API chính:
//   export function mergeHistoryObjects(baseObj, localObj, remoteObj): mergedObj
//
// Ý tưởng:
// - Hợp nhất theo từng tháng (key "YYYY-MM").
// - Mỗi tháng là mảng rows; ta đồng nhất theo "khóa mềm" cư dân:
//      key = slug(name|address), fallback "id-*"
// - Tính delta L (local vs base) và delta R (remote vs base), rồi áp vào base.
// - Khi xung đột trường, dùng resolver theo "ưu tiên an toàn dữ liệu":
//      • paid: true nếu local OR remote là true
//      • paidAt: chọn ngày hợp lệ mới nhất
//      • advance, __advance: lấy max
//      • prevDebt: lấy max (tránh làm mất nợ cũ)
//      • __elec, __water, __total: lấy max (bảng tính cục bộ có thể khác nhưng max an toàn)
//      • newElec/newWater/oldElec/oldWater: lấy max (tránh lùi số công tơ)
//      • strings (name/address/zone...): ưu tiên local (giả định thao tác hiện tại), nếu trống thì lấy remote
//      • các trường khác số: nếu cả 2 đều là số → max, nếu 1 undefined → lấy cái còn lại
//
// Ghi chú:
// - Đây là merge “an toàn”, ưu tiên giữ lại thông tin nhiều hơn thay vì mất bớt.
// - Nếu bạn muốn “last-writer-wins” dựa trên timestamp, có thể bổ sung trường updatedAt và chỉnh resolver.

// (Helpers moved to normalize.js)
const docIdFromRow = residentIdentity;

function indexByKey(arr) {
  const m = new Map();
  (Array.isArray(arr) ? arr : []).forEach((r) => {
    m.set(docIdFromRow(r), r);
  });
  return m;
}

function isDateStr(s) {
  if (!s || typeof s !== "string") return false;
  const t = Date.parse(s);
  return Number.isFinite(t);
}
function pickLatestDate(a, b) {
  if (isDateStr(a) && isDateStr(b)) {
    return Date.parse(a) >= Date.parse(b) ? a : b;
  }
  return isDateStr(a) ? a : isDateStr(b) ? b : (a || b || "");
}

function isNum(x) { return typeof x === "number" && Number.isFinite(x); }
function maxNumOr(otherwise, ...vals) {
  const nums = vals.filter(isNum);
  if (nums.length === 0) return otherwise;
  return Math.max(...nums);
}
function truthyOr(a, b) { return !!(a || b); }
function strPreferLocal(local, remote) {
  const l = (local ?? "").toString();
  const r = (remote ?? "").toString();
  return l || r; // ưu tiên local; nếu local rỗng thì lấy remote
}

function mergeRecordFields(base = {}, local = {}, remote = {}) {
  const out = { ...(base || {}) };

  // Các trường đặc thù:
  out.paid = truthyOr(local.paid, remote.paid);
  out.paidAt = pickLatestDate(local.paidAt, remote.paidAt);

  // số đo công tơ & tiền:
  out.oldElec   = maxNumOr(base.oldElec,   local.oldElec,   remote.oldElec);
  out.newElec   = maxNumOr(base.newElec,   local.newElec,   remote.newElec);
  out.oldWater  = maxNumOr(base.oldWater,  local.oldWater,  remote.oldWater);
  out.newWater  = maxNumOr(base.newWater,  local.newWater,  remote.newWater);

  // nợ & tạm ứng:
  out.prevDebt  = maxNumOr(base.prevDebt,  local.prevDebt,  remote.prevDebt);
  out.advance   = maxNumOr(base.advance,   local.advance,   remote.advance);
  out.__advance = maxNumOr(base.__advance, local.__advance, remote.__advance);

  // snapshot tiền tính sẵn:
  out.__elec  = maxNumOr(base.__elec,  local.__elec,  remote.__elec);
  out.__water = maxNumOr(base.__water, local.__water, remote.__water);
  out.__total = maxNumOr(base.__total, local.__total, remote.__total);
  out.__remaining = maxNumOr(base.__remaining, local.__remaining, remote.__remaining);

  // chuỗi mô tả:
  out.name    = strPreferLocal(local.name,    remote.name);
  out.address = strPreferLocal(local.address, remote.address);
  out.zone    = strPreferLocal(local.zone,    remote.zone);
  out.note    = strPreferLocal(local.note,    remote.note);

  // các trường khác: hợp nhất “an toàn”
  const keys = new Set([
    ...Object.keys(base || {}),
    ...Object.keys(local || {}),
    ...Object.keys(remote || {}),
  ]);
  keys.forEach((k) => {
    if (k in out) return; // đã xử lý
    const lv = local?.[k];
    const rv = remote?.[k];
    const bv = base?.[k];

    if (isNum(lv) || isNum(rv) || isNum(bv)) {
      out[k] = maxNumOr(bv, lv, rv);
      return;
    }
    // ưu tiên local nếu có, rồi tới remote, rồi base
    out[k] = lv ?? rv ?? bv;
  });

  return out;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === "object") {
    const ak = Object.keys(a), bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak) if (!deepEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}

function mergeMonthArrays(baseArr = [], localArr = [], remoteArr = []) {
  const baseMap   = indexByKey(baseArr);
  const localMap  = indexByKey(localArr);
  const remoteMap = indexByKey(remoteArr);

  const keys = new Set([
    ...baseMap.keys(),
    ...localMap.keys(),
    ...remoteMap.keys(),
  ]);

  const merged = [];
  for (const k of keys) {
    const b = baseMap.get(k);
    const l = localMap.get(k);
    const r = remoteMap.get(k);

    // TH1: chỉ có ở một phía → giữ nguyên
    if (!b && l && !r) { merged.push(l); continue; }
    if (!b && r && !l) { merged.push(r); continue; }

    // TH2: base có, 1 phía xóa (mất) và phía kia còn
    // Không xử lý "xóa" rõ ràng trong history → nếu một phía “thiếu” mà phía kia có dữ liệu, giữ dữ liệu (an toàn).
    if (b && l && !r) { merged.push(mergeRecordFields(b, l, {})); continue; }
    if (b && r && !l) { merged.push(mergeRecordFields(b, {}, r)); continue; }

    // TH3: cả hai phía đều có (có thể giống base hoặc đã sửa khác)
    if (b && l && r) {
      // nếu cả l & r đều không đổi so với base → giữ base
      const lSame = deepEqual(l, b);
      const rSame = deepEqual(r, b);
      if (lSame && rSame) { merged.push(b); continue; }

      // nếu chỉ 1 phía đổi → lấy phía đổi
      if (!lSame && rSame) { merged.push(mergeRecordFields(b, l, {})); continue; }
      if (lSame && !rSame) { merged.push(mergeRecordFields(b, {}, r)); continue; }

      // cả hai cùng đổi → dùng resolver
      merged.push(mergeRecordFields(b, l, r));
      continue;
    }

    // TH4: không có base (cả l & r đều thêm mới và có thể khác nhau) → merge “max-safe”
    if (!b && l && r) {
      merged.push(mergeRecordFields({}, l, r));
      continue;
    }

    // fallback: bỏ qua nếu hoàn toàn rỗng
  }

  return merged;
}

export function mergeHistoryObjects(baseObj = {}, localObj = {}, remoteObj = {}) {
  const out = {};
  const months = new Set([
    ...Object.keys(baseObj || {}),
    ...Object.keys(localObj || {}),
    ...Object.keys(remoteObj || {}),
  ]);

  for (const mk of months) {
    out[mk] = mergeMonthArrays(baseObj?.[mk], localObj?.[mk], remoteObj?.[mk]);
  }
  return out;
}
