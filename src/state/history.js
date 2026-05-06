// src/state/history.js
import { residentKey } from "../utils/normalize.js";
import { getJSON, setJSON, getStr, setStr, KEYS } from "./storage.js";
import { getCurrentMonth } from "../utils/date.js";
import { computeAmounts } from "./readings.js"; // dùng khi nhập/snapshot lịch sử

// >>> Đồng bộ phòng
import {
  isInRoom,
  pushAllToRoom,     // đẩy KEYS.current (residents)
  pushHistoryAll,    // đẩy KEYS.history
  pushMonthPtr,      // đẩy KEYS.month
} from "../sync/room.js";

// (Moved to src/utils/normalize.js)
const keyOf = residentKey;

/** dùng để đánh dấu đã áp lịch sử tháng trước vào tháng hiện tại (tránh cộng lặp) */
const KEY_APPLIED_PREV_HISTORY_PREFIX = "__applied_prev_history_for__";

/** Làm tròn nghìn */
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;

/** Tháng liền trước 'YYYY-MM' */
export function prevMonthOf(ym) {
  const [yStr, mStr] = String(ym || "").split("-");
  let y = +yStr || 0, m = +mStr || 1;
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, "0")}`;
}

/** Tạo snapshot có __elec/__water/__total/__advance/__remaining */
function snapshotRow(it) {
  const a = computeAmounts(it);
  return {
    ...it,
    __elec: a.elecMoney,
    __water: a.waterMoney,
    __total: a.total,
    __advance: a.advance,
    __remaining: a.remaining,
  };
}

/** Lấy số CÒN THIẾU để dồn nợ (ưu tiên snapshot nếu có) */
function carryRemaining(row) {
  if (Number.isFinite(row?.__remaining)) {
    return Math.max(0, Number(row.__remaining || 0));
  }
  const a = computeAmounts(row);
  return Math.max(0, a.total - Math.max(0, Number(row.advance || 0)));
}

/**
 * Chuyển tháng:
 *  - Lưu snapshot tháng cũ (nếu chưa có)
 *  - Reset bảng tháng mới:
 *      old = new (tháng trước), new = old
 *      prevDebt = phần CÒN THIẾU của tháng trước (đã trừ tạm thu, làm tròn nghìn); nếu đã đóng thì = 0
 *      advance/paid/... reset
 *  - Đẩy room: history + current + month
 */
export async function rolloverMonth() {
  const saved = getStr(KEYS.month, ""); // 'YYYY-MM' đã lưu
  const current = getCurrentMonth();    // 'YYYY-MM' hiện tại
  if (saved === current) return current;

  const currData = getJSON(KEYS.current, []);
  let shouldPushHistory = false;

  // Lưu snapshot tháng cũ (không ghi đè nếu đã có)
  if (saved && currData.length) {
    const hist = getJSON(KEYS.history, {});
    if (!hist[saved]) {
      hist[saved] = currData.map(snapshotRow);
      setJSON(KEYS.history, hist);
      shouldPushHistory = true;
    }
  }

  // Tháng mới
  const next = currData.map((it) => {
    const a = computeAmounts(it);
    const carry = it.paid ? 0 : roundK(a.remaining); // còn thiếu tháng trước
    const oldElec = +it.newElec || 0;
    const oldWater = +it.newWater || 0;

    return {
      ...it,
      oldElec,
      oldWater,
      newElec: oldElec,   // new = old để usage=0 ở đầu kỳ
      newWater: oldWater,
      prevDebt: carry,    // KHÔNG cộng dồn prevDebt cũ
      advance: 0,
      paid: false,
      paidAt: "",
      elecDate: "",
      waterDate: "",
      isNew: false,
    };
  });

  setJSON(KEYS.current, next);
  setStr(KEYS.month, current);

  if (isInRoom()) {
    if (shouldPushHistory) await pushHistoryAll(); // sync lịch sử
    await pushAllToRoom();  // sync current
    await pushMonthPtr();   // sync month
  }

  // reset marker chống “áp lịch sử tháng trước”
  const markerKey = `${KEY_APPLIED_PREV_HISTORY_PREFIX}${current}`;
  setStr(markerKey, ""); // clear để tháng mới có thể áp lịch sử tháng trước nếu cần

  return current;
}

/** Ép chuyển sang tháng hiện tại ngay lập tức (dùng khi đang “kẹt tháng”) */
export async function forceRolloverNow() {
  const current = getCurrentMonth();
  setStr(KEYS.month, prevMonthOf(current));
  return rolloverMonth();
}

/**
 * One-off: sửa tháng khi bạn đã lỡ lưu dữ liệu tháng 8 dưới nhãn tháng 9
 * - Sao lưu snapshot hiện tại vào history[tháng-1] (ghi đè, kèm __*)
 * - Reset bảng tháng hiện tại theo đúng quy tắc nợ = còn thiếu
 * - Đẩy room: history + current + month
 */
export async function forceCarryOverToCurrentMonth() {
  const currentYM = getCurrentMonth();
  const prevYM = prevMonthOf(currentYM);
  const currData = getJSON(KEYS.current, []);
  const hist = getJSON(KEYS.history, {});
  let shouldPushHistory = false;

  // 1) Ghi snapshot vào lịch sử tháng trước (ghi đè, có __*)
  if (currData.length) {
    hist[prevYM] = currData.map(snapshotRow);
    setJSON(KEYS.history, hist);
    shouldPushHistory = true;
  }

  const prevRows = hist[prevYM] || [];
  const histMap = new Map(prevRows.map((r) => [keyOf(r), r]));

  // 2) Tạo bảng tháng hiện tại đã reset
  const next = currData.map((it) => {
    const r = histMap.get(keyOf(it)) || it;
    const oldElec = +r.newElec || 0;
    const oldWater = +r.newWater || 0;
    const carry = r.paid ? 0 : roundK(carryRemaining(r));

    return {
      ...it,
      oldElec,
      oldWater,
      newElec: oldElec,   // new = old
      newWater: oldWater,
      prevDebt: carry,    // chỉ phần còn thiếu
      advance: 0,
      paid: false,
      paidAt: "",
      elecDate: "",
      waterDate: "",
      isNew: false,
    };
  });

  setJSON(KEYS.current, next);
  setStr(KEYS.month, currentYM);

  if (isInRoom()) {
    if (shouldPushHistory) await pushHistoryAll();
    await pushAllToRoom();
    await pushMonthPtr();
  }

  // clear marker cho tháng hiện tại
  const markerKey = `${KEY_APPLIED_PREV_HISTORY_PREFIX}${currentYM}`;
  setStr(markerKey, "");

  return { savedMonth: prevYM, currentMonth: currentYM, rows: next.length };
}

/**
 * Nhập một tháng lịch sử vào history[monthKey] (chuẩn hoá fields + snapshot __*),
 * Nếu monthKey == tháng LIỀN TRƯỚC tháng hiện tại:
 *  - Cập nhật LIST hiện tại:
 *      + oldElec/oldWater hiện tại = newElec/newWater của lịch sử
 *      + prevDebt hiện tại = phần CÒN THIẾU của tháng lịch sử (ưu tiên __remaining; đã trừ tạm ứng; đã đóng thì = 0; làm tròn nghìn)
 *  - Có marker để tránh cộng lặp
 *  - Đẩy room: history (+ current nếu có áp)
 */
export function importHistoryMonth(monthKey /* 'YYYY-MM' */, rows) {
  if (!/^\d{4}-\d{2}$/.test(monthKey))
    throw new Error("Tháng không hợp lệ (YYYY-MM)");

  const normalized = rows.map((r) => ({
    name: String(r.name || "").trim(),
    address: String(r.address || "").trim(),
    zone: r.zone || undefined,
    oldElec: +r.oldElec || 0,
    newElec: +r.newElec || 0,
    oldWater: +r.oldWater || 0,
    newWater: +r.newWater || 0,
    prevDebt: Math.max(0, +r.prevDebt || 0),
    advance: Math.max(0, +r.advance || 0),
    paid: !!r.paid,
    paidAt: r.paidAt ? String(r.paidAt) : "",
    elecDate: r.elecDate ? String(r.elecDate) : "",
    waterDate: r.waterDate ? String(r.waterDate) : "",
    isNew: false,
  }));

  // Lưu vào history (kèm snapshot __*)
  const hist = getJSON(KEYS.history, {});
  hist[monthKey] = normalized.map(snapshotRow);
  setJSON(KEYS.history, hist);

  // Nếu là tháng liền trước → đẩy ảnh hưởng sang LIST hiện tại (một lần duy nhất)
  const current = getCurrentMonth();
  if (monthKey === prevMonthOf(current)) {
    const markerKey = `${KEY_APPLIED_PREV_HISTORY_PREFIX}${current}`;
    const already = getStr(markerKey, "");
    if (already === monthKey) return; // đã áp rồi → không cộng lần 2

    const currList = getJSON(KEYS.current, []);
    const map = new Map(hist[monthKey].map((r) => [keyOf(r), r]));

    const updated = currList.map((it) => {
      const r = map.get(keyOf(it));
      if (!r) return it;

      const carry = r.paid ? 0 : roundK(carryRemaining(r)); // ưu tiên __remaining

      return {
        ...it,
        oldElec: +r.newElec || 0,
        oldWater: +r.newWater || 0,
        prevDebt: carry, // ghi đè bằng phần còn thiếu
      };
    });

    setJSON(KEYS.current, updated);
    setStr(markerKey, monthKey); // đánh dấu đã áp
  }
}
