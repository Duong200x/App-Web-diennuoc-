// src/state/readings.js
import { makeResidentId, residentIdentity, residentIdOf, residentKey } from "../utils/normalize.js";
import { getJSON, setJSON, KEYS } from "./storage.js";
import { getRates } from "./rates.js";
import { todayISO, getCurrentMonth } from "../utils/date.js";

/* ---------------- Helpers ---------------- */
const toInt = (v, def = 0) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
};

// làm tròn nghìn
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;

function carryRemaining(row) {
  if (!row) return 0;
  if (row.paid) return 0;
  if (Number.isFinite(row.__remaining)) {
    return Math.max(0, Number(row.__remaining || 0));
  }
  const a = computeAmounts(row);
  const advance = Number.isFinite(row.__advance)
    ? Number(row.__advance || 0)
    : Math.max(0, Number(row.advance || 0));
  return Math.max(0, a.total - advance);
}

function recalcHistorySnapshot(row, { keepUsageSnapshot = true } = {}) {
  const normalized = normalizeResident(row || {});
  const amounts = computeAmounts(normalized);
  const elec = keepUsageSnapshot && Number.isFinite(row?.__elec)
    ? Number(row.__elec || 0)
    : amounts.elecMoney;
  const water = keepUsageSnapshot && Number.isFinite(row?.__water)
    ? Number(row.__water || 0)
    : amounts.waterMoney;
  const debt = Math.max(0, Number(normalized.prevDebt || 0));
  const total = elec + water + debt;
  let advance = Math.max(0, Number(normalized.advance || 0));

  if (normalized.paid) {
    advance = total;
    normalized.advance = total;
  }

  const remaining = normalized.paid ? 0 : Math.max(total - advance, 0);
  return {
    ...normalized,
    __elec: elec,
    __water: water,
    __total: total,
    __advance: advance,
    __remaining: remaining,
  };
}

// YYYY-MM -> next month key
function nextMonthKey(ym) {
  try {
    const [yStr, mStr] = String(ym || getCurrentMonth()).split("-");
    let y = Number(yStr) || 0;
    let m = Number(mStr) || 1;
    m += 1;
    if (m > 12) { m = 1; y += 1; }
    return `${y}-${String(m).padStart(2, "0")}`;
  } catch {
    return getCurrentMonth();
  }
}

/* =============== Chuẩn hóa cư dân (compat cũ) =============== */
function normalizeResident(r) {
  const id = residentIdOf(r) || makeResidentId();
  const oldElec = toInt(r.oldElec, 0);
  const oldWater = toInt(r.oldWater, 0);

  // newElec/newWater fallback về old nếu thiếu
  const newElec = toInt(r.newElec, oldElec);
  const newWater = toInt(r.newWater, oldWater);

  const zone = r.zone || "khac";
  const address = zone === "khac" ? String(r.address || "").trim() : "";

  // FIX: nếu đã có chỉ số cũ > 0 thì không còn là cư dân mới
  const isNewFromData = !!r.isNew;
  const isNew = (oldElec === 0 && oldWater === 0) ? isNewFromData : false;

  return {
    id,
    residentId: id,
    name: String(r.name || "").trim(),
    zone,
    address,
    __order: Number.isFinite(Number(r.__order)) ? Number(r.__order) : undefined,

    oldElec,
    oldWater,
    newElec,
    newWater,

    elecDate: r.elecDate || "",
    waterDate: r.waterDate || "",

    isNew,                              // cư dân mới: tiền = new * rate
    prevDebt: Math.max(0, Number(r.prevDebt || 0)),

    // đã thu tạm ứng/thanh toán một phần kỳ hiện tại
    advance: Math.max(0, Number(r.advance || 0)),

    paid: !!r.paid,
    paidAt: r.paidAt || "",
    active: r.active !== false,
    movedOutAt: r.movedOutAt || "",
    updatedAt: r.updatedAt || r.updated_at || "",

    // Persist snapshot fields if they exist
    __elec: r.__elec,
    __water: r.__water,
    __total: r.__total,
    __advance: r.__advance,
    __remaining: r.__remaining,
  };
}

/* ------------- State helpers ------------- */
export const listResidents = () =>
  getJSON(KEYS.current, []).map(normalizeResident);

export const saveResidents = (arr) =>
  setJSON(KEYS.current, arr.map((row, idx) => normalizeResident({ ...row, __order: idx })));

function ensureUniqueResidentKey(rows, nextRow, ignoreIdx = -1) {
  const nextKey = residentKey(nextRow);
  if (!nextKey) return;
  const nextId = residentIdOf(nextRow);
  const dupIdx = rows.findIndex((row, idx) => (
    idx !== ignoreIdx
    && residentKey(row) === nextKey
    && (!nextId || residentIdOf(row) !== nextId)
  ));
  if (dupIdx !== -1) {
    throw new Error("Cư dân với tên và địa chỉ/khu này đã tồn tại");
  }
}

export function ensureResidentIds() {
  const rawCurrent = getJSON(KEYS.current, []);
  const normalizedCurrent = rawCurrent.map(normalizeResident);
  const idByLegacyKey = new Map();
  normalizedCurrent.forEach((row) => {
    const key = residentKey(row);
    if (key && !idByLegacyKey.has(key)) idByLegacyKey.set(key, residentIdOf(row));
  });

  const hist = getJSON(KEYS.history, {});
  let touchedHistory = false;
  const normalizedHistory = {};
  for (const monthKey of Object.keys(hist || {})) {
    const rows = Array.isArray(hist[monthKey]) ? hist[monthKey] : [];
    normalizedHistory[monthKey] = rows.map((row) => {
      const existingId = residentIdOf(row);
      const legacyId = idByLegacyKey.get(residentKey(row));
      const normalized = normalizeResident({ ...row, id: existingId || legacyId || makeResidentId() });
      if (!existingId || normalized.id !== row.id || normalized.residentId !== row.residentId) touchedHistory = true;
      return normalized;
    });
  }

  const currentChanged = JSON.stringify(rawCurrent) !== JSON.stringify(normalizedCurrent);
  if (currentChanged) saveResidents(normalizedCurrent);
  if (touchedHistory) saveHistory(normalizedHistory);
  return { currentChanged, historyChanged: touchedHistory };
}

/* ------------- CRUD functions ------------- */
/** Thêm cư dân mới */
export function addResident({
  name,
  zone = "khac",
  address = "",
  startElec = 0,
  startWater = 0,
}) {
  const arr = listResidents();
  const today = todayISO();
  const se = toInt(startElec, 0);
  const sw = toInt(startWater, 0);

  // FIX: nếu có chỉ số khởi điểm -> không phải cư dân mới
  const isNew = (se === 0 && sw === 0);

  const row = normalizeResident({
    name,
    zone,
    address: zone === "khac" ? address : "",
    oldElec: se,
    oldWater: sw,
    newElec: se,
    newWater: sw,
    elecDate: today,
    waterDate: today,
    isNew,
    prevDebt: 0,
    advance: 0,
    paid: false,
    paidAt: "",
  });

  ensureUniqueResidentKey(arr, row);
  arr.push(row);
  saveResidents(arr);
}

/** Cập nhật nhanh newElec/newWater + tự set ngày nếu đổi số */
export function updateInline(idx, { newElec, newWater }) {
  const arr = listResidents();
  const it = arr[idx];
  if (!it) throw new Error("Không tìm thấy cư dân");

  const ne = newElec != null ? toInt(newElec, it.newElec) : it.newElec;
  const nw = newWater != null ? toInt(newWater, it.newWater) : it.newWater;

  if (ne < toInt(it.oldElec)) throw new Error("Số điện mới không được nhỏ hơn số cũ");
  if (nw < toInt(it.oldWater)) throw new Error("Số nước mới không được nhỏ hơn số cũ");

  const today = todayISO();
  const patch = {};
  if (ne !== it.newElec) { patch.newElec = ne; patch.elecDate = today; }
  if (nw !== it.newWater) { patch.newWater = nw; patch.waterDate = today; }

  // Không cần đụng isNew: normalizeResident sẽ đảm bảo đúng theo chỉ số cũ
  arr[idx] = normalizeResident({ ...it, ...patch });
  saveResidents(arr);
  return arr[idx];
}

/** Cập nhật đầy đủ 1 cư dân (có ràng buộc new >= old) */
export function updateFull(idx, patch) {
  const arr = listResidents();
  const prev = arr[idx];
  if (!prev) throw new Error("Không tìm thấy cư dân");

  const merged = { ...prev, ...patch };

  // Zone & address: nếu không phải "khac" thì xóa address thủ công
  if (patch.hasOwnProperty("zone")) {
    merged.zone = patch.zone || "khac";
    if (merged.zone !== "khac") merged.address = "";
  }
  if (merged.zone !== "khac") merged.address = "";

  // Chuẩn hóa số
  if (patch.hasOwnProperty("oldElec")) merged.oldElec = toInt(patch.oldElec, prev.oldElec);
  if (patch.hasOwnProperty("oldWater")) merged.oldWater = toInt(patch.oldWater, prev.oldWater);
  if (patch.hasOwnProperty("newElec")) merged.newElec = toInt(patch.newElec, prev.newElec);
  if (patch.hasOwnProperty("newWater")) merged.newWater = toInt(patch.newWater, prev.newWater);

  if (toInt(merged.newElec) < toInt(merged.oldElec))
    throw new Error("Số điện mới không được nhỏ hơn số cũ");
  if (toInt(merged.newWater) < toInt(merged.oldWater))
    throw new Error("Số nước mới không được nhỏ hơn số cũ");

  const today = todayISO();
  if (patch.hasOwnProperty("newElec") && toInt(merged.newElec) !== toInt(prev.newElec))
    merged.elecDate = today;
  if (patch.hasOwnProperty("newWater") && toInt(merged.newWater) !== toInt(prev.newWater))
    merged.waterDate = today;

  // FIX: nếu có chỉ số cũ > 0 thì không phải cư dân mới
  const hasStart = (toInt(merged.oldElec) > 0) || (toInt(merged.oldWater) > 0);
  if (hasStart) {
    merged.isNew = false;
  } else {
    // chỉ khi cả 2 chỉ số cũ = 0 mới cho phép giữ/đổi isNew
    if (patch.hasOwnProperty("isNew")) {
      merged.isNew = !!patch.isNew;
    } else {
      merged.isNew = !!prev.isNew;
    }
  }

  // Thanh toán / nợ / tạm ứng
  if (patch.hasOwnProperty("prevDebt")) {
    merged.prevDebt = Math.max(0, Number(patch.prevDebt) || 0);
  }
  if (patch.hasOwnProperty("advance")) {
    merged.advance = Math.max(0, Number(patch.advance) || 0);
  }
  if (patch.hasOwnProperty("paid")) {
    merged.paid = !!patch.paid;
    merged.paidAt = merged.paid ? today : "";
  }

  const nextRow = normalizeResident(merged);
  ensureUniqueResidentKey(arr, nextRow, idx);
  arr[idx] = nextRow;
  saveResidents(arr);
  return arr[idx];
}

/** 🔧 Quản lý: cập nhật KHÔNG ràng buộc (bỏ kiểm tra new < old) */
export function updateFullAdmin(idx, patch) {
  const arr = listResidents();
  const prev = arr[idx];
  if (!prev) throw new Error("Không tìm thấy cư dân");

  const today = todayISO();
  const merged = { ...prev, ...patch };

  // Zone & address
  if (patch.hasOwnProperty("zone")) {
    merged.zone = patch.zone || "khac";
    if (merged.zone !== "khac") merged.address = "";
  }
  if (merged.zone !== "khac") merged.address = "";

  // Chuẩn hoá số (KHÔNG ném lỗi khi new < old)
  if (patch.hasOwnProperty("oldElec"))   merged.oldElec  = toInt(patch.oldElec,  prev.oldElec);
  if (patch.hasOwnProperty("oldWater"))  merged.oldWater = toInt(patch.oldWater, prev.oldWater);
  if (patch.hasOwnProperty("newElec"))  { merged.newElec = toInt(patch.newElec,  prev.newElec);  if (toInt(merged.newElec)  !== toInt(prev.newElec))  merged.elecDate  = today; }
  if (patch.hasOwnProperty("newWater")) { merged.newWater= toInt(patch.newWater, prev.newWater); if (toInt(merged.newWater) !== toInt(prev.newWater)) merged.waterDate = today; }

  // FIX: logic isNew tương tự updateFull
  const hasStart = (toInt(merged.oldElec) > 0) || (toInt(merged.oldWater) > 0);
  if (hasStart) {
    merged.isNew = false;
  } else {
    if (patch.hasOwnProperty("isNew")) merged.isNew = !!patch.isNew;
    else merged.isNew = !!prev.isNew;
  }

  // Thanh toán / nợ / tạm ứng
  if (patch.hasOwnProperty("prevDebt")) merged.prevDebt = Math.max(0, Number(patch.prevDebt) || 0);
  if (patch.hasOwnProperty("advance"))  merged.advance  = Math.max(0, Number(patch.advance)  || 0);
  if (patch.hasOwnProperty("paid"))    { merged.paid    = !!patch.paid; merged.paidAt = merged.paid ? today : ""; }

  const nextRow = normalizeResident(merged);
  ensureUniqueResidentKey(arr, nextRow, idx);
  arr[idx] = nextRow;
  saveResidents(arr);
  return arr[idx];
}

/** Nhận tạm ứng (trả trước một phần) */
export function addAdvance(idx, amount) {
  const arr = listResidents();
  const it = arr[idx];
  if (!it) throw new Error("Không tìm thấy cư dân");

  const add = Math.max(0, Number(amount) || 0);
  const { total } = computeAmounts(it);
  const nextAdvance = Math.min((it.advance || 0) + add, total);
  const paid = nextAdvance >= total;
  const today = todayISO();

  arr[idx] = normalizeResident({
    ...it,
    advance: nextAdvance,
    paid,
    paidAt: paid ? today : (it.paid ? it.paidAt : "")
  });

  saveResidents(arr);
  return arr[idx];
}

/** Xóa cư dân
 *  Trả về bản ghi đã bị xóa để caller có thể sync tombstone (_deleted).
 *  Nếu idx không hợp lệ → trả về null.
 */
export function removeResident(idx) {
  const arr = listResidents(); // đã normalize
  if (idx < 0 || idx >= arr.length) return null;

  const removed = arr[idx]; // giữ lại để trả về
  arr.splice(idx, 1);
  saveResidents(arr);
  return removed;
}

/** Đánh dấu đã đóng/huỷ đóng tiền
 *  - KHÔNG tự động sửa/tăng `advance`
 *  - Khi paid=true, remaining sẽ = 0 theo computeAmounts()
 */
export function setPaid(idx, paid) {
  const arr = listResidents();
  const it = arr[idx];
  if (!it) throw new Error("Không tìm thấy cư dân");
  const now = todayISO();

  const patch = { paid: !!paid, paidAt: paid ? now : "" };
  arr[idx] = normalizeResident({ ...it, ...patch });
  saveResidents(arr);
  return arr[idx];
}

/** Chỉnh tay nợ cũ cho 1 cư dân (để khớp thực tế/biên lai) */
export function setPrevDebt(idx, amount) {
  const arr = listResidents();
  const it = arr[idx];
  if (!it) throw new Error("Không tìm thấy cư dân");
  arr[idx] = normalizeResident({ ...it, prevDebt: Math.max(0, Number(amount) || 0) });
  saveResidents(arr);
  return arr[idx];
}

/* ------------- Tính tiền ------------- */
/**
 * - isNew=true: tiền = new * rate (không trừ old)
 * - ngược lại: (new - old) * rate
 * - cộng thêm prevDebt (nợ cũ)
 * - NEW: trả trước (advance) & còn thiếu (remaining)
 * → total là TỔNG ĐÃ GỒM NỢ
 * - Khi paid=true → remaining = 0 (không động advance)
 */
export function computeAmounts(item) {
  const { electricityRate, waterRate } = getRates();

  const oldE = toInt(item.oldElec);
  const newE = toInt(item.newElec);
  const oldW = toInt(item.oldWater);
  const newW = toInt(item.newWater);

  const elecUsage  = item.isNew ? newE : Math.max(0, newE - oldE);
  const waterUsage = item.isNew ? newW : Math.max(0, newW - oldW); // ✅ fixed

  const elecMoney  = elecUsage  * Number(electricityRate || 0);
  const waterMoney = waterUsage * Number(waterRate || 0);

  const prevDebt = Math.max(0, Number(item.prevDebt || 0));
  const total    = elecMoney + waterMoney + prevDebt;

  const advance  = Math.max(0, Number(item.advance || 0));
  const paid     = !!item.paid;

  // Khi đã đóng: còn thiếu = 0 (KHÔNG đụng vào advance)
  const remaining = paid ? 0 : Math.max(total - advance, 0);

  return { elecUsage, waterUsage, elecMoney, waterMoney, prevDebt, total, advance, remaining };
}

/* ------------- Chuyển tháng (Rollover) ------------- */
/**
 * Tạo dữ liệu tháng kế theo quy tắc:
 * 1) Nếu cư dân đã đóng (paid=true)  → prevDebt(next) = 0
 * 2) Nếu cư dân chưa đóng            → prevDebt(next) = roundK(remaining hiện tại)
 * 3) Dịch chỉ số: old = new; reset ngày đo & paid; isNew=false; advance=0
 * 4) Lưu lịch sử tháng hiện tại vào history[month] (snapshot __elec/__water/__total/__advance/__remaining)
 */
// (Function rolloverToNextMonth removed in favor of history.js:rolloverMonth)


/* ============== Lịch sử ============== */
export function getHistory() {
  return getJSON(KEYS.history, {}); // { "YYYY-MM": Resident[] }
}
export function saveHistory(h) {
  setJSON(KEYS.history, h || {});
}
export function listHistoryMonthsDesc() {
  const h = getHistory();
  return Object.keys(h).sort((a,b) => (a < b ? 1 : a > b ? -1 : 0)); // mới nhất trước
}
function assertPastOrCurrentMonth(monthKey) {
  const cur = getCurrentMonth();      // YYYY-MM
  if (!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error("Tháng không hợp lệ (YYYY-MM)");
  if (monthKey > cur) throw new Error("Không thể nhập/thêm tháng tương lai");
}

// Xóa nguyên bảng tháng
export function deleteHistoryMonth(monthKey) {
  const h = getHistory();
  if (!h[monthKey]) return false;
  delete h[monthKey];
  saveHistory(h);
  // Sau khi xoá 1 tháng lịch sử -> cập nhật lại nợ đang hiển thị ở tháng hiện tại
  recomputePrevDebtFromHistory();
  return true;
}

// Lưu/sửa 1 bảng tháng (khi import/điều chỉnh hàng loạt). Tự snapshot tổng để không lệ thuộc vào đơn giá hiện tại.
export function saveHistoryMonthSnapshot(monthKey, rows /* Resident[] đã normalize */) {
  assertPastOrCurrentMonth(monthKey);
  // snapshot tổng (giữ nguyên theo thời điểm ghi)
  const snap = rows.map(r => {
    const row = recalcHistorySnapshot(r, { keepUsageSnapshot: false });
    return {
      ...row,
    };
  });
  const h = getHistory();
  h[monthKey] = snap;
  saveHistory(h);
  snap.forEach((row) => propagateDebtUpdates(monthKey, row));
  // Thêm/sửa lịch sử -> đồng bộ nợ về tháng hiện tại
  recomputePrevDebtFromHistory();
}

// Sửa 1 dòng trong bảng tháng (chủ yếu cho prevDebt / paid)
export function updateHistoryRow(monthKey, idx, patch) {
  const h = getHistory();
  const rows = h[monthKey];
  if (!rows || !rows[idx]) throw new Error("Không tìm thấy bản ghi lịch sử");
  const prev = rows[idx];
  const nextInput = { ...prev, ...patch };

  // tính lại snapshot: elec/water ưu tiên __* nếu có, chỉ cập nhật tổng & remaining theo prevDebt mới
  const elec = Number.isFinite(prev.__elec) ? Number(prev.__elec || 0) : computeAmounts(nextInput).elecMoney;
  const water = Number.isFinite(prev.__water) ? Number(prev.__water || 0) : computeAmounts(nextInput).waterMoney;
  // Luôn lấy advance từ dữ liệu mới nhất (merged) thay vì giữ snapshot cũ
  let advanceSnap = Math.max(0, Number(nextInput.advance || 0));
  const debt = Math.max(0, Number(nextInput.prevDebt || 0));
  const total = elec + water + debt;

  // Nếu đánh dấu ĐÃ ĐÓNG mà chưa có tạm ứng -> coi như thu đủ
  if (nextInput.paid) {
    advanceSnap = total;
    nextInput.advance = total;
  }
  // Nếu vừa hủy ĐÃ ĐÓNG mà số tạm ứng đang bằng/đè tổng tháng
  // thì trả về 0 để số còn thiếu hiển thị đúng.
  if (!nextInput.paid && prev?.paid && !patch.hasOwnProperty("advance")) {
    if (advanceSnap >= total) {
      advanceSnap = 0;
      nextInput.advance = 0;
    }
  }

  const remaining = nextInput.paid ? 0 : Math.max(total - advanceSnap, 0);

  rows[idx] = {
    ...normalizeResident(nextInput),
    __elec: elec,
    __water: water,
    __total: total,
    __advance: advanceSnap,
    __remaining: remaining,
  };
  h[monthKey] = rows;
  saveHistory(h);

  // mọi chỉnh sửa lịch sử -> dồn lại nợ cho tháng hiện tại (và CÁC THÁNG SAU NẾU CÓ)
  propagateDebtUpdates(monthKey, rows[idx]);
  recomputePrevDebtFromHistory();
  return rows[idx];
}

/**
 * Đổi định danh cư dân trong toàn bộ lịch sử khi đổi tên/địa chỉ/khu.
 * Mục tiêu: tránh đứt chuỗi dồn nợ do residentKey thay đổi.
 */
export function renameResidentInHistory(oldResident, newResident) {
  const oldKey = residentKey(oldResident || {});
  const newKey = residentKey(newResident || {});
  const newId = residentIdOf(newResident) || residentIdOf(oldResident);
  if (!oldKey || !newKey) return 0;

  const h = getHistory();
  let touched = 0;

  for (const monthKey of Object.keys(h)) {
    const rows = Array.isArray(h[monthKey]) ? h[monthKey] : [];
    if (!rows.length) continue;

    const oldIdx = rows.findIndex((r) => (
      (newId && residentIdOf(r) === newId) || residentKey(r) === oldKey
    ));
    if (oldIdx === -1) continue;

    // Nếu tháng này đã có sẵn bản ghi mang key mới thì bỏ qua để tránh đụng dữ liệu.
    const hasNew = rows.some((r, idx) => (
      idx !== oldIdx && residentKey(r) === newKey && (!newId || residentIdOf(r) !== newId)
    ));
    if (hasNew) continue;

    const rowId = newId || residentIdOf(rows[oldIdx]) || makeResidentId();
    rows[oldIdx] = {
      ...rows[oldIdx],
      id: rowId,
      residentId: rowId,
      name: String(newResident?.name || "").trim(),
      zone: newResident?.zone || "khac",
      address: newResident?.zone === "khac" ? String(newResident?.address || "").trim() : "",
    };
    h[monthKey] = rows;
    touched++;
  }

  if (touched > 0) {
    saveHistory(h);
    recomputePrevDebtFromHistory();
  }
  return touched;
}

/* ---------------- FIX DỒN NỢ LAN TRUYỀN (CHAIN UPDATES) ---------------- */
/**
 * Khi sửa tháng T (monthKey), hàm này tìm tháng T+1, cập nhật PrevDebt = Remaining(T).
 * Nếu Remaining(T+1) thay đổi, tiếp tục gọi đệ quy cho T+2...
 * Cho đến khi hết lịch sử.
 */
function propagateDebtUpdates(startMonth, resident) {
  const hist = getJSON(KEYS.history, {});
  let curr = startMonth;
  const targetId = residentIdOf(resident);
  const targetKey = residentKey(resident || {});

  // Lặp qua các tháng tiếp theo
  while (true) {
    const next = nextMonthKey(curr);
    if (!hist[next]) break; // Hết lịch sử -> Stop (recomputePrevDebtFromHistory sẽ lo phần Current)

    // Tìm cư dân trong tháng kế
    const nextRows = hist[next];
    // NOTE: Còng logic khớp chính xác như recomputePrevDebtFromHistory
    const idx = nextRows.findIndex(r => (
      (targetId && residentIdOf(r) === targetId) || residentKey(r) === targetKey
    ));

    if (idx === -1) break; // Không tìm thấy người này ở tháng sau -> Stop chain

    // Tìm data tháng hiện tại (curr) để lấy remaining
    const currRows = hist[curr];
    const currRow = currRows.find(r => (
      (targetId && residentIdOf(r) === targetId) || residentKey(r) === targetKey
    ));
    if (!currRow) break; // Should not happen

    // Tính nợ mang sang: Nếu đã paid -> 0, ngược lại lấy remaining
    const carry = roundK(carryRemaining(currRow));

    // Check xem có cần update không
    const nextRow = nextRows[idx];
    const oldPrevDebt = Math.max(0, Number(nextRow.prevDebt || 0));

    if (Math.abs(oldPrevDebt - carry) < 100) {
      // Coi như không đổi -> Stop lan truyền
      break; 
    }

    // Update & Recalculate
    const merged = recalcHistorySnapshot({ ...nextRow, prevDebt: carry });

    // Snapshot lại
    const elec = Number(nextRow.__elec || 0);
    const water = Number(nextRow.__water || 0);
    // Giữ nguyên advance cũ của tháng đó (vì ta chỉ đang đổi nợ đầu kỳ)
    const advanceSnap = Number(merged.__advance || 0);
    
    // Tính lại total & remaining
    // Total = Elec + Water + NewPrevDebt
    const total = elec + water + Math.max(0, Number(merged.prevDebt || 0));
    const remaining = merged.paid ? 0 : Math.max(total - advanceSnap, 0);

    nextRows[idx] = {
      ...merged,
      __elec: elec,
      __water: water,
      __total: total,
      __advance: advanceSnap,
      __remaining: remaining
    };

    // Lưu lại và tiếp tục loop
    hist[next] = nextRows;
    setJSON(KEYS.history, hist);
    
    curr = next;
  }
}

export function propagateHistoryDebtFromMonth(monthKey) {
  const hist = getJSON(KEYS.history, {});
  const rows = Array.isArray(hist?.[monthKey]) ? hist[monthKey] : [];
  rows.forEach((row) => propagateDebtUpdates(monthKey, row));
  recomputePrevDebtFromHistory();
}


/**
 * [FIX] Dồn nợ CHỈ TỪ THÁNG GẦN NHẤT trong lịch sử (≤ tháng hiện tại) cho mỗi cư dân.
 * Tránh cộng dồn nhiều tháng (đếm trùng). Ưu tiên snapshot __remaining nếu có.
 */
export function recomputePrevDebtFromHistory() {
  const curMonth = getCurrentMonth();
  const hist = getJSON(KEYS.history, {});
  const months = Object.keys(hist)
    .filter((m) => /^\d{4}-\d{2}$/.test(m) && m <= curMonth)
    .sort((a, b) => a.localeCompare(b)); // cũ -> mới

  // Với mỗi cư dân (theo key name|address), lưu hàng GẦN NHẤT
  const latestByKey = new Map(); // key -> row
  for (const m of months) {
    const rows = hist[m] || [];
    for (const r of rows) {
      const key = residentIdentity(r);
      // Ghi đè để tháng sau (mới hơn) replace tháng trước
      latestByKey.set(key, r);
    }
  }

  const curr = listResidents();
  const updated = curr.map((it) => {
    const key = residentIdentity(it);
    const r = latestByKey.get(key);
    if (!r) return it;

    // Nếu tháng gần nhất đã paid thì nợ = 0, ngược lại lấy remaining
    let remain;
    if (Number.isFinite(r?.__remaining)) {
      remain = Math.max(0, Number(r.__remaining || 0));
    } else {
      const a = computeAmounts(r);
      const adv = Number.isFinite(r?.__advance) ? Number(r.__advance || 0) : Math.max(0, Number(r.advance || 0));
      remain = Math.max(0, a.total - adv);
    }
    const nextDebt = r?.paid ? 0 : roundK(remain); // ✅ added roundK

    if (toInt(it.prevDebt) === toInt(nextDebt)) return it;
    return normalizeResident({ ...it, prevDebt: nextDebt });
  });

  saveResidents(updated);
  return updated;
}
