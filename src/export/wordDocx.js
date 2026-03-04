import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
} from "docx";
import { computeAmounts } from "../state/readings.js";
import { getStr, KEYS } from "../state/storage.js";
import { vnLongDate, getCurrentMonth } from "../utils/date.js";
import { saveBlobSmart } from "../utils/save.js";
import { exportWordOne as exportWordHtml } from "./word.js"; // fallback .doc (HTML)

const twip = (cm) => Math.round((cm / 2.54) * 1440);
const money = (n) => Number(n || 0).toLocaleString("vi-VN");

// Làm tròn nghìn
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;

// Paragraph helper (mặc định 15pt = size 30)
function p(text, { bold=false, italics=false, center=false, size=30 } = {}) {
  return new Paragraph({
    alignment: center ? AlignmentType.CENTER : AlignmentType.LEFT,
    children: [ new TextRun({ text, bold, italics, size }) ],
    spacing: { after: 120 },
  });
}

function sectionFor(item) {
  const contact = getStr(KEYS.contact, "");
  const due = getStr(KEYS.due, "");

  const amounts = computeAmounts(item);
  const { elecUsage, waterUsage, elecMoney, waterMoney, total } = amounts;
  const prevDebt = Number((amounts && amounts.prevDebt != null) ? amounts.prevDebt : (item.prevDebt || 0));

  // Đơn giá mặc định
  const rateE = Number(localStorage.getItem(KEYS.rateE) ?? 2800);
  const rateW = Number(localStorage.getItem(KEYS.rateW) ?? 10500);

  const totalRounded = roundK(total);
  const ngayDien = item.elecDate ? vnLongDate(item.elecDate) : "";
  const ngayNuoc = item.waterDate ? vnLongDate(item.waterDate) : "";

  const children = [
    p("NGƯỜI QUẢN LÍ TRẦN YẾN", { bold:true, center:true }),
    p("PHIẾU THU ĐIỆN", { bold:true, center:true }),
    p(ngayDien),
    p(`Gửi nhà ông/bà: ${item.name || ""}`),

    p(`Số điện mới: ${item.newElec} kWh`),
    p(`Số điện cũ: ${item.oldElec} kWh`),
    p(`Tổng điện sử dụng: ${elecUsage} kWh × ${money(rateE)} đ = ${money(elecMoney)} đ`),

    p(""),
    p("PHIẾU THU NƯỚC", { bold:true, center:true }),
    p(ngayNuoc),
    p(`Số nước mới: ${item.newWater} m³`),
    p(`Số nước cũ: ${item.oldWater} m³`),
    p(`Tổng nước sử dụng: ${waterUsage} m³ × ${money(rateW)} đ = ${money(waterMoney)} đ`),

    p(""),
    p(`Nợ kỳ trước: ${money(prevDebt)} đ`), // ➜ THÊM DÒNG NỢ
    p(`Tổng tiền điện nước (đã làm tròn nghìn): ${money(totalRounded)} đ`, { bold:true }),
    p("(Chỉ nhận TIỀN MẶT vui lòng thanh toán đúng hạn, QUÁ HẠN SẼ CẮT ĐIỆN!!!)", { italics:true }),
    ...(due ? [p(`HẠN THANH TOÁN: ${due}`)] : []),
    ...(contact ? [p(`Liên hệ: ${contact}`)] : []),
  ];

  return {
    properties: { page: { margin: { top: twip(2), right: twip(2), bottom: twip(2), left: twip(2) } } },
    children,
  };
}

function safeName(s) {
  return (s || "phieu").toLowerCase().replace(/[^a-z0-9]+/gi, "_");
}

export async function exportWordOneDocx(item) {
  try {
    const doc = new Document({
      styles: { default: { document: { run: { font: "Times New Roman", size: 30 } } } },
      sections: [ sectionFor(item) ],
    });
    const blob = await Packer.toBlob(doc);
    await saveBlobSmart(blob, `phieu_${safeName(item.name)}_${getCurrentMonth()}.docx`);
  } catch (err) {
    // Fallback: xuất .doc (HTML) để đảm bảo APK luôn có file
    try {
      const tpl = getStr(KEYS.tpl, "");
      await exportWordHtml(item, tpl);
      alert("Không tạo được .docx, đã chuyển sang xuất .doc (HTML).");
    } catch (e2) {
      alert("Xuất Word thất bại: " + (err?.message || "Không rõ lỗi"));
      throw err;
    }
  }
}

export async function exportWordAllDocx(items) {
  if (!items?.length) return;
  try {
    const doc = new Document({
      styles: { default: { document: { run: { font: "Times New Roman", size: 30 } } } },
      sections: items.map(sectionFor),
    });
    const blob = await Packer.toBlob(doc);
    await saveBlobSmart(blob, `phieu_tong_hop_${getCurrentMonth()}.docx`);
  } catch (err) {
    const tpl = getStr(KEYS.tpl, "");
    for (const it of items) {
      await exportWordHtml(it, tpl);
    }
    alert("Không tạo được .docx tổng hợp, đã xuất từng phiếu .doc (HTML).");
  }
}
