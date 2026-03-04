import ExcelJS from "exceljs";
import { computeAmounts } from "../state/readings.js";
import { getCurrentMonth } from "../utils/date.js";
import { saveArrayBufferSmart, saveTextSmart } from "../utils/save.js";
import { zoneLabel } from "../state/zones.js"; // ⬅️ dùng để hiện nhãn khu

// Làm tròn nghìn
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;

function ym() {
  const [yStr, mStr] = getCurrentMonth().split("-");
  const y = Number(yStr), m = Number(mStr);
  const prev = ((m + 10) % 12) + 1; // m-1 (1->12)
  return { y, m, prev };
}

async function saveXlsx(workbook, filename) {
  const buf = await workbook.xlsx.writeBuffer();
  await saveArrayBufferSmart(
    buf,
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    filename
  );
}

export async function exportExcel(items, monthKey) {
  // Parse monthKey "YYYY-MM" -> y, m
  let dateFunc = getCurrentMonth; 
  if (monthKey && /^\d{4}-\d{2}$/.test(monthKey)) {
    dateFunc = () => monthKey;
  }
  
  const [yStr, mStr] = dateFunc().split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  // prev month for header (T{prev})
  const prev = ((m + 10) % 12) + 1; // (m-1) logic: if m=1 -> prev=12

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Thang_${String(m).padStart(2, "0")}_${y}`);

  const title = `BẢNG ĐIỆN NƯỚC • Tháng ${m} - ${y}`;
  const headers = [
    "Tên nhà",
    "Địa chỉ/Khu",
    `điện T${prev}`, `ĐIỆN T${m}`, "số điện đã sài", "TỔNG ĐIỆN",
    `nước T${prev}`, `NƯỚC T${m}`, "số NƯỚC đã sài", "TỔNG NƯỚC",
    "NỢ KỲ TRƯỚC",
    "TỔNG CỘNG (đã làm tròn nghìn)",
    "ĐÓNG TIỀN (Y/N)",
  ];

  // A1..(headers.length) tiêu đề
  ws.mergeCells(1, 1, 1, headers.length);
  const tCell = ws.getCell(1, 1);
  tCell.value = title;
  tCell.font = { bold: true, size: 14 };
  tCell.alignment = { horizontal: "center" };

  ws.addRow([]);
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true };
  headerRow.alignment = { vertical: "middle", horizontal: "center" };

  let sumE = 0, sumW = 0, sumDebt = 0, sumTRounded = 0;

  // ---- GỘP THEO KHU: 3 TỔNG TIỀN (điện, nước, cả hai) ----
  const zoneBuckets = {
    tren: { label: "Khu Trên",  e: 0, w: 0, all: 0 },
    giua: { label: "Khu Giữa",  e: 0, w: 0, all: 0 },
    duoi: { label: "Khu Dưới",  e: 0, w: 0, all: 0 },
    khac: { label: "Khác",      e: 0, w: 0, all: 0 },
  };

  // Thu thập dữ liệu cho fallback CSV
  const csvRows = [];

  for (const it of items) {
    const amounts = computeAmounts(it);
    const { elecUsage, waterUsage, elecMoney, waterMoney, total } = amounts;
    const prevDebt = Number((amounts && amounts.prevDebt != null) ? amounts.prevDebt : (it.prevDebt || 0));
    const totalRounded = roundK(total);

    sumE += elecMoney || 0;
    sumW += waterMoney || 0;
    sumDebt += prevDebt || 0;
    sumTRounded += totalRounded || 0;

    const addr = (it.zone && it.zone !== "khac") ? zoneLabel(it.zone) : (it.address || "");

    const rowArr = [
      it.name || "",
      addr,                                      // ⬅️ GHI ĐỊA CHỈ/KHU
      Number(it.oldElec || 0),
      Number(it.newElec || 0),
      Number(elecUsage || 0),
      Number(elecMoney || 0),      // tiền điện
      Number(it.oldWater || 0),
      Number(it.newWater || 0),
      Number(waterUsage || 0),
      Number(waterMoney || 0),     // tiền nước
      Number(prevDebt || 0),
      Number(totalRounded || 0),   // tổng tiền (đã làm tròn)
      (it.paid ? "Y" : "N"),
    ];
    csvRows.push(rowArr);

    const row = ws.addRow(rowArr);
    row.alignment = { vertical: "middle" };

    const k = (it.zone || "khac");
    const b = zoneBuckets[k] || zoneBuckets.khac;
    b.e   += elecMoney   || 0;
    b.w   += waterMoney  || 0;
    b.all += totalRounded|| 0; // tổng mỗi nhà (đã làm tròn)
  }

  // Hàng tổng chính (chèn thêm 1 ô trống cho cột Địa chỉ/Khu)
  const totalRowArr = [
    "TỔNG",
    "",                              // địa chỉ/khu
    "", "", "", Math.round(sumE || 0),
    "", "", "", Math.round(sumW || 0),
    Math.round(sumDebt || 0),
    Math.round(sumTRounded || 0),
    "",
  ];
  const totalRow = ws.addRow(totalRowArr);
  totalRow.font = { bold: true };

  // Độ rộng cột (13 cột)
  const widths = [28, 18, 12, 12, 16, 16, 12, 12, 18, 16, 16, 22, 14];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));

  // Định dạng số: cột 3..12 (cột 13 là Y/N, cột 2 là địa chỉ text)
  const numFmtCols = [3,4,5,6,7,8,9,10,11,12];
  numFmtCols.forEach((c) => { ws.getColumn(c).numFmt = '#,##0'; });

  // Viền header
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: "FFDADADA" } },
      left:{ style: "thin", color: { argb: "FFDADADA" } },
      bottom:{ style: "thin", color: { argb: "FFDADADA" } },
      right:{ style: "thin", color: { argb: "FFDADADA" } },
    };
  });

  // ===== BẢNG "TỔNG THEO KHU (tiền)" =====
  ws.addRow([]);
  const titleRowIdx = ws.addRow(["TỔNG THEO KHU (tiền)"]).number;
  ws.mergeCells(titleRowIdx, 1, titleRowIdx, 4);
  const t2 = ws.getCell(titleRowIdx, 1);
  t2.font = { bold: true, size: 13 };
  t2.alignment = { horizontal: "center" };

  const subHeader = ws.addRow(["Khu", "Tổng tiền điện (đ)", "Tổng tiền nước (đ)", "Tổng (đ)"]);
  subHeader.font = { bold: true };
  subHeader.alignment = { vertical: "middle", horizontal: "center" };

  const addZoneMoneyRow = (label, b) => {
    const r = ws.addRow([label, Math.round(b.e), Math.round(b.w), Math.round(b.all)]);
    r.getCell(2).numFmt = '#,##0';
    r.getCell(3).numFmt = '#,##0';
    r.getCell(4).numFmt = '#,##0';
  };
  (["tren","giua","duoi","khac"]).forEach(k => {
    const b = zoneBuckets[k];
    if (!b) return;
    const has = (b.e || b.w || b.all);
    if (has) addZoneMoneyRow(b.label, b);
  });

  const rSum = ws.addRow(["TỔNG", Math.round(sumE), Math.round(sumW), Math.round(sumTRounded)]);
  rSum.font = { bold: true };
  rSum.getCell(2).numFmt = '#,##0';
  rSum.getCell(3).numFmt = '#,##0';
  rSum.getCell(4).numFmt = '#,##0';

  // Lưu file
  const fname = `dien_nuoc_${y}-${String(m).padStart(2, "0")}.xlsx`;
  try {
    await saveXlsx(wb, fname);
  } catch (err) {
    console.error("ExcelJS writeBuffer error:", err);
    // Fallback CSV (nhẹ, chạy được trên mọi WebView)
    const toCsvCell = (v) => {
      const s = (v == null ? "" : String(v));
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers,
      ...csvRows,
      totalRowArr,
      [],
      ["TỔNG THEO KHU (tiền)"],
      ["Khu","Tổng tiền điện (đ)","Tổng tiền nước (đ)","Tổng (đ)"],
      ...Object.values(zoneBuckets)
        .filter(b => (b.e || b.w || b.all))
        .map(b => [b.label, Math.round(b.e), Math.round(b.w), Math.round(b.all)]),
      ["TỔNG", Math.round(sumE), Math.round(sumW), Math.round(sumTRounded)]
    ].map(row => row.map(toCsvCell).join(",")).join("\n");

    const csvName = `dien_nuoc_${y}-${String(m).padStart(2, "0")}_fallback.csv`;
    await saveTextSmart(csv, "text/csv", csvName);
    alert("Xuất Excel không thành công (ExcelJS). Đã xuất file CSV thay thế (có tổng theo khu).");
  }
}
