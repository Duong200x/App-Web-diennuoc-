// src/export/word.js
import { saveTextSmart } from "../utils/save.js";
import { getCurrentMonth, vnLongDate } from "../utils/date.js";
import { computeAmounts } from "../state/readings.js";
import { getStr, KEYS } from "../state/storage.js";

const money = (n) => Number(n || 0).toLocaleString("vi-VN");

// MẪU MẶC ĐỊNH (footer sẽ tự chèn sát đáy, nên không để Hạn TT/Liên hệ trong template)
const DEFAULT_TPL = `
NGƯỜI QUẢN LÍ {{APP_NAME}}
              PHIẾU THU ĐIỆN

{{NGAY_DIEN_DAY}}
Gửi nhà ông/bà: {{TEN}}

Số điện mới: {{DIEN_MOI}} kWh
Số điện cũ: {{DIEN_CU}} kWh
Tổng điện sử dụng: {{DIEN_TIEUTHU}} kWh  ×  {{DON_GIA_DIEN_FMT}}  =  {{TIEN_DIEN}} đ


              PHIẾU THU NƯỚC

{{NGAY_NUOC_DAY}}
Số nước mới: {{NUOC_MOI}} m³
Số nước cũ: {{NUOC_CU}} m³
Tổng nước sử dụng: {{NUOC_TIEUTHU}} m³  ×  {{DON_GIA_NUOC_FMT}}  =  {{TIEN_NUOC}} đ

Nợ kỳ trước: {{NO_KY_TRUOC}} đ

Tổng tiền điện nước:   {{TONG}} đ

(Chỉ nhận tiền mặt)
`.trim();

function renderTemplateEnsureDebt(tpl, map) {
  // nếu người dùng dùng template cũ không có {{NO_KY_TRUOC}} thì tự chèn một dòng
  let base = (tpl && tpl.trim()) ? tpl : DEFAULT_TPL;
  if (!/\{\{NO_KY_TRUOC\}\}/.test(base)) {
    base += `\n\nNợ kỳ trước: {{NO_KY_TRUOC}} đ`;
  }
  Object.keys(map).forEach((k) => {
    base = base.replace(new RegExp(`\\{{2}${k}\\}{2}`, "g"), String(map[k]));
  });
  return base;
}

// Đơn giá (mặc định 2800 / 10500)
function rates() {
  const e = Number(localStorage.getItem(KEYS.rateE) ?? 2800);
  const w = Number(localStorage.getItem(KEYS.rateW) ?? 10500);
  return { e, w, eFmt: `${money(e)} đ`, wFmt: `${money(w)} đ` };
}

function fillMap(item) {
  const amounts = computeAmounts(item);
  const { elecUsage, waterUsage, elecMoney, waterMoney, total } = amounts;
  // nợ kỳ trước: nếu computeAmounts có prevDebt thì dùng, không thì rơi về item.prevDebt, cuối cùng là 0
  const prevDebt = Number(
    (amounts && amounts.prevDebt != null) ? amounts.prevDebt : (item.prevDebt || 0)
  );

  const { e, w, eFmt, wFmt } = rates();

  return {
    APP_NAME: "Quản lý ghi số điện nước",
    TEN: item.name || "",
    DIA_CHI: item.address || "",

    // Điện
    DIEN_CU: item.oldElec ?? "",
    DIEN_MOI: item.newElec ?? "",
    DIEN_TIEUTHU: elecUsage ?? 0,
    TIEN_DIEN: money(elecMoney),

    // Nước
    NUOC_CU: item.oldWater ?? "",
    NUOC_MOI: item.newWater ?? "",
    NUOC_TIEUTHU: waterUsage ?? 0,
    TIEN_NUOC: money(waterMoney),

    // NỢ + Tổng
    NO_KY_TRUOC: money(prevDebt),
    TONG: money(total),

    // Đơn giá
    DON_GIA_DIEN: e,
    DON_GIA_NUOC: w,
    DON_GIA_DIEN_FMT: eFmt,
    DON_GIA_NUOC_FMT: wFmt,

    // Ngày ghi
    NGAY_DIEN_DAY: vnLongDate(item.elecDate || ""),
    NGAY_NUOC_DAY: vnLongDate(item.waterDate || ""),

    // Footer
    THANG_NAM: getCurrentMonth(),
    HAN_THANH_TOAN: getStr(KEYS.due, ""),
    LIEN_HE: getStr(KEYS.contact, "")
  };
}

// tạo 1 "trang" có body + footer sát đáy trang
function renderPageHtml(contentHtml, due, contact) {
  const footerDue = due ? `<div>Hạn thanh toán: ${due}</div>` : "";
  const footerContact = contact ? `<div>Liên hệ: ${contact}</div>` : "";

  return `
  <div class="page">
    <div class="body">${contentHtml}</div>
    <div class="footer">
      ${footerDue}
      ${footerContact}
    </div>
  </div>`;
}

function htmlShell(inner) {
  // Toàn bộ A4, Times 15pt; footer 15pt để đồng nhất cỡ chữ
  return `<!doctype html>
<html><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 0; }
  body { margin: 0; }
  .page {
    position: relative;
    width: 21cm; min-height: 29.7cm;
    box-sizing: border-box;
    padding: 2cm;
    page-break-after: always;
    font-family: 'Times New Roman', serif;
    font-size: 15pt; line-height: 1.5;
    white-space: pre-wrap;
  }
  .body { padding-bottom: 2.2cm; }
  .footer {
    position: absolute; left: 2cm; right: 2cm; bottom: 1.2cm;
    font-size: 15pt;
  }
</style>
</head><body>${inner}</body></html>`;
}

export async function exportWordOne(item, templateText) {
  const map = fillMap(item);
  const content = renderTemplateEnsureDebt(templateText, map);
  const page = renderPageHtml(content, map.HAN_THANH_TOAN, map.LIEN_HE);
  const html = htmlShell(page);
  const safe = (item.name || "phieu").toLowerCase().replace(/[^a-z0-9]+/gi, "_");
  await saveTextSmart(html, "application/msword", `phieu_${safe}_${getCurrentMonth()}.doc`);
}

export async function exportWordAll(items, templateText) {
  if (!items.length) return;
  const pages = items.map(it => {
    const map = fillMap(it);
    const c = renderTemplateEnsureDebt(templateText, map);
    return renderPageHtml(c, map.HAN_THANH_TOAN, map.LIEN_HE);
  }).join("");
  const html = htmlShell(pages);
  await saveTextSmart(html, "application/msword", `phieu_tong_hop_${getCurrentMonth()}.doc`);
}
