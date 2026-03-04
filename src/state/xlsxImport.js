// src/state/xlsxImport.js
import * as XLSX from "xlsx";
import { deaccent } from "../utils/normalize.js";

// ---------- helpers ----------
const norm = (s) => deaccent(s).toLowerCase().trim();

const toInt = (v) => {
  const n = String(v ?? "").replace(/[^\d]/g, "");
  return n ? Number(n) : 0;
};

const toBoolPaid = (v) => {
  const s = norm(String(v ?? "")).replace(/\s+/g, " ");
  return /^(y|yes|true|1|x|da|da dong|dong|dong tien|thanh toan|paid)$/i.test(s);
};

// alias mềm cho các cột text (tháng/tên/địa chỉ) + prevDebt + paid
const ALIASES = {
  month:   ["month", "tháng", "thang", "thang nam", "thang_nam", "mm/yyyy", "yyyy-mm"],
  name:    ["tên nhà", "ten nha", "tên", "ten", "ho ten", "name", "nhà", "nha", "chu ho"],
  address: ["địa chỉ", "dia chi", "address", "khu", "tổ dân phố", "to dan pho", "khu vuc"],
  prevDebt:["nợ", "nợ kỳ trước", "no ky truoc", "no cu", "prev debt", "debt", "cong no"],
  paid:    ["đóng tiền", "da dong", "đã đóng", "thanh toan", "paid", "trang thai", "paid?"],
};

// Loại các hàng tổng/tiêu đề khu khỏi import
function isSummaryName(name) {
  const n = norm(name);
  if (!n) return true; // rỗng -> bỏ

  // các biến thể "TỔNG / TỔNG CỘNG / TỔNG TIỀN / TOTAL ..."
  if (/(^|\s)(tong|tong cong|tong tien|total)(\s|$)/.test(n)) return true;
  if (n.includes("tong theo khu")) return true;

  // các tiêu đề phân vùng "Theo khu ..."
  if (/^(theo\s+khu)/.test(n)) return true;

  // mọi hàng bắt đầu bằng "Khu ..." (Khu Trên/Giữa/Dưới/Khác…)
  if (/^khu(\s|$)/.test(n)) return true;

  // các biến thể cụ thể (phòng khi file chỉ ghi đúng cụm)
  const exact = [
    "khu", "khu tren", "khu duoi", "khu giua", "khu khac",
    "tren", "duoi", "giua","khac"
  ];
  if (exact.includes(n)) return true;

  return false;
}

// Dò dòng header tốt nhất trong vài dòng đầu
function pickHeaderRow(rows2d, maxScan = 8) {
  let bestIdx = 0, bestScore = -1;
  const keyHints = [
    /ten|nha/,
    /dien|di?n/,
    /nuoc|nuo?c/,
    /thang|t[\s\.\-]*\d+/,
    /no|cong no|dong tien|paid/,
  ];
  for (let i = 0; i < Math.min(rows2d.length, maxScan); i++) {
    const row = rows2d[i] || [];
    const s = row.map((c) => norm(String(c || ""))).filter(Boolean).join(" | ");
    const score = keyHints.reduce((acc, re) => acc + (re.test(s) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; bestIdx = i; }
  }
  return bestIdx;
}

function buildHeaderBaseMap(headers) {
  const map = {};
  const H = headers.map(norm);
  for (const key of ["month", "name", "address", "prevDebt", "paid"]) {
    const idx = H.findIndex((h) =>
      (ALIASES[key] || []).some((a) => {
        const na = norm(a);
        return h === na || h.includes(na);
      })
    );
    if (idx >= 0) map[key] = headers[idx];
  }
  return map;
}

// Bắt các cột dạng “Điện T5 / Điện tháng 5”
function detectMeterColumns(headers) {
  const out = { elec: [], water: [] }; // {col, m}
  for (const col of headers) {
    const h = norm(col);

    // điện
    let m = h.match(/(dien|đien|đi?n)\s*t[\s\.\-]*([0-9]{1,2})/);
    if (m) { const mm = Number(m[2]); if (mm >= 1 && mm <= 12) out.elec.push({ col, m: mm }); continue; }
    m = h.match(/(dien|đien|đi?n).{0,8}(thang|tháng)[\s\.\-]*([0-9]{1,2})/);
    if (m) { const mm = Number(m[3]); if (mm >= 1 && mm <= 12) out.elec.push({ col, m: mm }); continue; }

    // nước
    m = h.match(/(nuoc|nuóc|nươc|nước)\s*t[\s\.\-]*([0-9]{1,2})/);
    if (m) { const mm = Number(m[2]); if (mm >= 1 && mm <= 12) out.water.push({ col, m: mm }); continue; }
    m = h.match(/(nuoc|nuóc|nươc|nước).{0,8}(thang|tháng)[\s\.\-]*([0-9]{1,2})/);
    if (m) { const mm = Number(m[3]); if (mm >= 1 && mm <= 12) out.water.push({ col, m: mm }); continue; }
  }
  return out;
}

function chooseOldNewCols(detected, targetMonth /* 1..12 or null */) {
  const out = { oldElecCol: null, newElecCol: null, oldWaterCol: null, newWaterCol: null };

  const pick = (arr, tm) => {
    if (!arr.length) return [null, null];
    if (tm && Number.isFinite(tm)) {
      const prev = ((tm + 10) % 12) + 1; // tm-1 (wrap 1->12)
      const old = arr.find((x) => x.m === prev);
      const neu = arr.find((x) => x.m === tm);
      if (old && neu) return [old.col, neu.col];
    }
    const sorted = [...arr].sort((a, b) => a.m - b.m);
    if (sorted.length >= 2) return [sorted[0].col, sorted[sorted.length - 1].col];
    return [null, null];
  };

  const [oe, ne] = pick(detected.elec, targetMonth);
  const [ow, nw] = pick(detected.water, targetMonth);

  out.oldElecCol = oe;
  out.newElecCol = ne;
  out.oldWaterCol = ow;
  out.newWaterCol = nw;
  return out;
}

// ---------- main ----------
export async function parseHistoryXlsx(file, opts = {}) {
  const monthKey = opts.monthKey || "";
  let targetMonth = null;
  if (/^\d{4}-\d{2}$/.test(monthKey)) targetMonth = Number(monthKey.slice(5, 7));

  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];

  const rows2d = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  if (!rows2d.length) return [];

  const headerRow = pickHeaderRow(rows2d);
  const headers = (rows2d[headerRow] || []).map((h, i) => (h ? String(h) : `col_${i}`));
  const body = rows2d.slice(headerRow + 1).filter((r) => (r || []).some((c) => String(c).trim() !== ""));

  const rows = body.map((r) => {
    const o = {};
    headers.forEach((h, i) => (o[h] = r[i]));
    return o;
  });

  const baseMap = buildHeaderBaseMap(headers);

  // Suy ra targetMonth nếu có cột month
  if (!targetMonth && baseMap.month && rows.length) {
    const first = String(rows[0][baseMap.month] || "").trim();
    if (/^\d{4}-\d{2}$/.test(first)) targetMonth = Number(first.slice(5, 7));
    else if (/^\d{1,2}\/\d{4}$/.test(first)) targetMonth = Number(first.split("/")[0]);
  }

  const detected = detectMeterColumns(headers);
  const chosen = chooseOldNewCols(detected, targetMonth);

  const miss = [];
  if (!chosen.oldElecCol) miss.push("điện tháng trước (ví dụ Điện T4 / Điện tháng 4)");
  if (!chosen.newElecCol) miss.push("điện tháng này (ví dụ Điện T5 / Điện tháng 5)");
  if (!chosen.oldWaterCol) miss.push("nước tháng trước (ví dụ Nước T4 / Nước tháng 4)");
  if (!chosen.newWaterCol) miss.push("nước tháng này (ví dụ Nước T5 / Nước tháng 5)");
  if (miss.length) throw new Error("Không nhận dạng được cột: " + miss.join(", "));

  // Chuẩn hóa & LỌC bỏ hàng tổng/khu
  const out = rows
    .map((r) => ({
      name: String(baseMap.name ? r[baseMap.name] : "").trim(),
      address: baseMap.address ? String(r[baseMap.address] || "").trim() : "",
      oldElec: toInt(r[chosen.oldElecCol]),
      newElec: toInt(r[chosen.newElecCol]),
      oldWater: toInt(r[chosen.oldWaterCol]),
      newWater: toInt(r[chosen.newWaterCol]),
      prevDebt: baseMap.prevDebt ? toInt(r[baseMap.prevDebt]) : 0,
      paid: baseMap.paid ? toBoolPaid(r[baseMap.paid]) : false,
      month: monthKey || "",
    }))
    .filter((x) => x.name && !isSummaryName(x.name));

  return out;
}

// CSV fallback (nếu cần)
export function parseHistoryCsv(text) {
  const sep = text.includes("\t") ? "\t" : text.includes(";") ? ";" : ",";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const header = lines[0].split(sep).map((h) => h.trim());
  const Hn = header.map(norm);

  const idxExact = (k) => header.findIndex((h) => norm(h) === norm(k));
  const idxAlias = (key) => {
    const aliases = ALIASES[key] || [];
    for (let i = 0; i < Hn.length; i++) {
      const h = Hn[i];
      if (aliases.some((a) => {
        const na = norm(a);
        return h === na || h.includes(na);
      })) return i;
    }
    return -1;
  };

  const need = ["name", "address", "oldElec", "newElec", "oldWater", "newWater"];
  for (const k of need) if (idxExact(k) === -1) throw new Error("CSV thiếu cột: " + k);

  const iPrev = idxAlias("prevDebt");
  const iPaid = idxAlias("paid");

  const out = lines.slice(1).map((line) => {
    const cells = line.split(sep).map((c) => c.trim());
    return {
      name: cells[idxExact("name")] || "",
      address: cells[idxExact("address")] || "",
      oldElec: toInt(cells[idxExact("oldElec")]),
      newElec: toInt(cells[idxExact("newElec")]),
      oldWater: toInt(cells[idxExact("oldWater")]),
      newWater: toInt(cells[idxExact("newWater")]),
      prevDebt: iPrev >= 0 ? toInt(cells[iPrev]) : 0,
      paid: iPaid >= 0 ? toBoolPaid(cells[iPaid]) : false,
    };
  }).filter((x) => x.name && !isSummaryName(x.name));

  return out;
}
