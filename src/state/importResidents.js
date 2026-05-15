// src/state/importResidents.js
import * as XLSX from "xlsx";
import { residentIdentity, residentKey, deaccent } from "../utils/normalize.js";
import { getJSON, setJSON, setStr, KEYS } from "./storage.js";
import { getCurrentMonth } from "../utils/date.js";

/* ===== Utils ===== */
// (Common markers moved to normalize.js)
const keyOf = residentIdentity;
const legacyKeyOf = residentKey;

function existingImportKey(map, row) {
  const idKey = keyOf(row);
  if (map.has(idKey)) return idKey;
  const legacyKey = legacyKeyOf(row);
  for (const [k, v] of map.entries()) {
    if (legacyKeyOf(v) === legacyKey) return k;
  }
  return idKey;
}

const norm = (s) => String(s ?? "").trim();
const noAccent = (s) =>
  deaccent(norm(s)).toLowerCase();

const num = (v) => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v ?? "")
    .replace(/\s+/g, "")
    .replace(/[.,](?=\d{3}\b)/g, "") // bỏ dấu nghìn 1.234.567 -> 1234567
    .replace(/[^\d+\-.,]/g, "")
    .replace(/,/g, ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const prevYM = (ym) => {
  const [y, m] = String(ym).split("-").map((x) => +x);
  const pm = m === 1 ? 12 : m - 1, py = m === 1 ? y - 1 : y;
  return `${py}-${String(pm).padStart(2, "0")}`;
};

// Bỏ số thứ tự trước tên (vd "1,trung" -> "trung")
function cleanName(raw) {
  let s = norm(raw);
  const m = s.match(/^\s*\d+\s*[\.,-]\s*(.+)$/);
  if (m) s = m[1];
  return s;
}

/* ===== Header analyzer: bắt T<month>, điện/nước cũ/mới, "đã xài", tổng, paid, debt, advance ===== */
function analyzeHeaderRow(cells) {
  const cols = cells.map(noAccent);

  let nameIdx = -1, addrIdx = -1, debtIdx = -1, advIdx = -1, paidIdx = -1;

  // cột cũ/mới dạng text (không theo tháng)
  let elecOldIdx = -1, elecNewIdx = -1, waterOldIdx = -1, waterNewIdx = -1;

  // cột "đã xài/sử dụng/tiêu thụ"
  let elecUsedIdx = -1, waterUsedIdx = -1;

  // cột tổng (ít dùng, chỉ để suy luận vị trí)
  let elecTotalIdx = -1, waterTotalIdx = -1;

  // map tháng
  const elecByMonth = new Map(), waterByMonth = new Map();

  const hasAny = (c, arr) => arr.some(k => c.includes(k));

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];

    // cơ bản
    if (nameIdx < 0 && (hasAny(c, ["ten nha", "ho ten", "name"]) || c === "ten")) nameIdx = i;
    else if (addrIdx < 0 && (hasAny(c, ["dia chi", "address"]) || c === "khu")) addrIdx = i;
    else if (debtIdx < 0 && hasAny(c, ["no cu", "no ky truoc"])) debtIdx = i;
    else if (advIdx  < 0 && hasAny(c, ["tam ung", "advance", "deposit"])) advIdx = i;
    else if (paidIdx < 0 && hasAny(c, ["da dong", "dong tien", "paid"])) paidIdx = i;

    // cũ/mới rõ ràng
    if (elecOldIdx < 0 && hasAny(c, ["dien cu"])) elecOldIdx = i;
    if (elecNewIdx < 0 && hasAny(c, ["dien moi"])) elecNewIdx = i;
    if (waterOldIdx < 0 && hasAny(c, ["nuoc cu"])) waterOldIdx = i;
    if (waterNewIdx < 0 && hasAny(c, ["nuoc moi"])) waterNewIdx = i;

    // usage / tổng
    if (elecUsedIdx < 0 && (hasAny(c, [
      "so dien","dien su dung","dien tieu thu","dien da xai","dien da sai","dien dung"
    ]))) elecUsedIdx = i;
    if (waterUsedIdx < 0 && (hasAny(c, [
      "so nuoc","nuoc su dung","nuoc tieu thu","nuoc da xai","nuoc da sai","nuoc dung"
    ]))) waterUsedIdx = i;
    if (elecTotalIdx < 0 && hasAny(c, ["tong dien"])) elecTotalIdx = i;
    if (waterTotalIdx < 0 && hasAny(c, ["tong nuoc"])) waterTotalIdx = i;

    // T<month> cho điện / nước (ví dụ: "điện T8", "nuoc t 9")
    const m = c.match(/t\s*(\d{1,2})/);
    if (m) {
      const mm = +m[1];
      if (mm >= 1 && mm <= 12) {
        if (hasAny(c, ["dien", "kwh"])) elecByMonth.set(mm, i);
        if (hasAny(c, ["nuoc", "m3"]))  waterByMonth.set(mm, i);
      }
    }
  }

  if (nameIdx < 0) return null;
  return {
    nameIdx, addrIdx, debtIdx, advIdx, paidIdx,
    elecByMonth, waterByMonth,
    elecOldIdx, elecNewIdx, waterOldIdx, waterNewIdx,
    elecUsedIdx, waterUsedIdx,
    elecTotalIdx, waterTotalIdx,
  };
}

/* Hàng nhóm/tổng: chỉ xét Ô TÊN để tránh loại nhầm */
function isSummaryOrGroupRow(nameCell) {
  const n = noAccent(nameCell);
  return (
    n === "tong" || n.startsWith("tong ") || n.includes("tong theo khu") ||
    n === "khu"  || n.startsWith("khu ")  ||
    n === "khac"
  );
}

/* Chọn old/new theo tháng có mặt (min->old, max->new) */
function pickOldNewIdx(monthMap) {
  if (!monthMap || monthMap.size === 0) return { oldIdx: -1, newIdx: -1 };
  const months = Array.from(monthMap.keys()).sort((a,b) => a - b);
  return { oldIdx: monthMap.get(months[0]), newIdx: monthMap.get(months[months.length-1]) };
}

/* Tìm header tốt nhất: quét tới 30 hàng, đếm số ROW hợp lệ bên dưới và chọn nhiều nhất */
function findBestHeader(wb) {
  let best = { sheetName: null, headerRow: -1, headerInfo: null, score: -1, rows: 0 };

  for (const sn of wb.SheetNames) {
    const ws = wb.Sheets[sn];
    const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });

    const lim = Math.min(30, data.length); // ⬆️ 10 -> 30
    for (let r = 0; r < lim; r++) {
      const hi = analyzeHeaderRow(data[r] || []);
      if (!hi) continue;

      // thử đếm số dòng dữ liệu phía dưới
      let count = 0;
      for (let i = r + 1; i < data.length; i++) {
        const row = data[i] || [];
        const name = cleanName(row[hi.nameIdx]);
        const addr = hi.addrIdx >= 0 ? norm(row[hi.addrIdx]) : "";
        if (!name && !addr) continue;
        if (isSummaryOrGroupRow(name)) continue;
        count++;
      }

      // điểm ưu tiên: nhiều dòng > điểm header
      const score = count * 10 +
        (hi.elecByMonth.size ? 2 : 0) +
        (hi.waterByMonth.size ? 2 : 0) +
        (hi.elecOldIdx >= 0 && hi.elecNewIdx >= 0 ? 1 : 0) +
        (hi.waterOldIdx >= 0 && hi.waterNewIdx >= 0 ? 1 : 0);

      if (count > best.rows || (count === best.rows && score > best.score)) {
        best = { sheetName: sn, headerRow: r, headerInfo: hi, score, rows: count };
      }
    }
  }

  return best.sheetName ? best : null;
}

/* Đọc sheet theo layout thực tế, không phụ thuộc tháng hệ thống */
function readRowsSmart(wb) {
  const best = findBestHeader(wb);
  if (!best) return [];

  const ws = wb.Sheets[best.sheetName];
  const data = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", blankrows: false });
  const hi = best.headerInfo;

  // xác định cột điện
  let idxOE = hi.elecOldIdx, idxNE = hi.elecNewIdx;
  if (idxOE < 0 || idxNE < 0) {
    const p = pickOldNewIdx(hi.elecByMonth);
    if (idxOE < 0) idxOE = p.oldIdx;
    if (idxNE < 0) idxNE = p.newIdx;
  }
  const canBackCalcElec = (idxOE < 0) && (idxNE >= 0) && (hi.elecUsedIdx >= 0);

  // xác định cột nước
  let idxOW = hi.waterOldIdx, idxNW = hi.waterNewIdx;
  if (idxOW < 0 || idxNW < 0) {
    const p2 = pickOldNewIdx(hi.waterByMonth);
    if (idxOW < 0) idxOW = p2.oldIdx;
    if (idxNW < 0) idxNW = p2.newIdx;
  }
  // fallback: nếu vẫn thiếu, suy theo layout phổ biến “… | TỔNG ĐIỆN | nước cũ | nước mới …”
  if ((idxOW < 0 || idxNW < 0) && hi.elecTotalIdx >= 0) {
    idxOW = (idxOW < 0) ? hi.elecTotalIdx + 1 : idxOW;
    idxNW = (idxNW < 0) ? hi.elecTotalIdx + 2 : idxNW;
  }
  const canBackCalcWater = (idxOW < 0) && (idxNW >= 0) && (hi.waterUsedIdx >= 0);

  const out = [];
  for (let r = best.headerRow + 1; r < data.length; r++) {
    const row = data[r] || [];
    const rawName = row[hi.nameIdx];
    const rawAddr = hi.addrIdx >= 0 ? row[hi.addrIdx] : "";
    const name = cleanName(rawName);
    const address = norm(rawAddr);

    if (!name && !address) continue;
    if (isSummaryOrGroupRow(name)) continue; // chỉ xét tên để không loại nhầm

    // trạng thái thanh toán / nợ / tạm ứng
    const paidRaw = hi.paidIdx >= 0 ? row[hi.paidIdx] : "";
    const paid = String(paidRaw).trim().toUpperCase() === "Y" ||
                 String(paidRaw).trim() === "1" ||
                 String(paidRaw).trim().toLowerCase() === "true";

    const prevDebt = hi.debtIdx >= 0 ? num(row[hi.debtIdx]) : 0;
    const advance  = hi.advIdx  >= 0 ? num(row[hi.advIdx])  : 0;

    // điện & nước
    const newElec  = idxNE >= 0 ? num(row[idxNE]) : 0;
    let   oldElec  = idxOE >= 0 ? num(row[idxOE]) : 0;
    if (canBackCalcElec) oldElec = Math.max(0, newElec - num(row[hi.elecUsedIdx]));

    const newWater = idxNW >= 0 ? num(row[idxNW]) : 0;
    let   oldWater = idxOW >= 0 ? num(row[idxOW]) : 0;
    if (canBackCalcWater) oldWater = Math.max(0, newWater - num(row[hi.waterUsedIdx]));

    out.push({
      name, address,
      oldElec, newElec,
      oldWater, newWater,
      prevDebt: Math.max(0, prevDebt),
      advance:  Math.max(0, advance),
      paid,
      paidAt: "",
      elecDate: "",
      waterDate: "",
      isNew: false,
    });
  }

  return out;
}

/* ===== Import XLSX vào BẢNG HIỆN TẠI (không đụng lịch sử) ===== */
export async function importResidentsFromXlsxToCurrent(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });

  const rows = readRowsSmart(wb);
  const total = rows.length;

  const current = getCurrentMonth(); // chỉ để set KEYS.month
  const cur = getJSON(KEYS.current, []);
  const map = new Map(cur.map((x) => [keyOf(x), x]));
  let added = 0, updated = 0;

  rows.forEach((r) => {
    const k = existingImportKey(map, r);
    if (map.has(k)) {
      const e = map.get(k);
      map.set(k, {
        id: e.id || e.residentId,
        residentId: e.residentId || e.id,
        ...e,
        oldElec: r.oldElec, newElec: r.newElec,
        oldWater: r.oldWater, newWater: r.newWater,
        prevDebt: r.prevDebt, advance: r.advance,
        paid: r.paid,
      });
      updated++;
    } else {
      map.set(k, {
        id: r.id || r.residentId,
        residentId: r.residentId || r.id,
        name: r.name, address: r.address,
        oldElec: r.oldElec, newElec: r.newElec,
        oldWater: r.oldWater, newWater: r.newWater,
        prevDebt: r.prevDebt, advance: r.advance,
        paid: r.paid, paidAt: "",
        elecDate: "", waterDate: "", isNew: false,
      });
      added++;
    }
  });

  setJSON(KEYS.current, Array.from(map.values()));
  setStr(KEYS.month, current);
  return { total, added, updated, mode: "current", month: current };
}

/* ===== (Tuỳ chọn) Import JSON backup vào BẢNG HIỆN TẠI ===== */
export async function importResidentsFromJsonToCurrent(fileOrText) {
  const text = typeof fileOrText === "string" ? fileOrText : await fileOrText.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error("JSON không hợp lệ"); }

  const rows = Array.isArray(data)
    ? data
    : Array.isArray(data.current) ? data.current
    : Array.isArray(data.residents) ? data.residents
    : [];

  if (!rows.length) throw new Error("JSON không có mảng cư dân hợp lệ");

  const current = getCurrentMonth();
  const cur = getJSON(KEYS.current, []);
  const map = new Map(cur.map((x) => [keyOf(x), x]));
  let added = 0, updated = 0;

  rows.forEach((r0) => {
    const r = {
      id: norm(r0.id || r0.residentId || ""),
      residentId: norm(r0.residentId || r0.id || ""),
      name: norm(r0.name),
      address: norm(r0.address || r0.zone || ""),
      oldElec: num(r0.oldElec), newElec: num(r0.newElec),
      oldWater: num(r0.oldWater), newWater: num(r0.newWater),
      prevDebt: Math.max(0, num(r0.prevDebt)),
      advance: Math.max(0, num(r0.advance)),
      paid: !!r0.paid,
      paidAt: norm(r0.paidAt || ""),
      elecDate: norm(r0.elecDate || ""),
      waterDate: norm(r0.waterDate || ""),
      isNew: !!r0.isNew,
    };
    const k = existingImportKey(map, r);
    if (map.has(k)) { map.set(k, { ...map.get(k), ...r }); updated++; }
    else { map.set(k, r); added++; }
  });

  setJSON(KEYS.current, Array.from(map.values()));
  setStr(KEYS.month, current);
  return { total: rows.length, added, updated, mode: "current", month: current };
}
