// src/views/DetailView.js
import { listResidents, computeAmounts } from "../state/readings.js";
import { money } from "../utils/format.js";
import { monthYearLabel, fmtDMY } from "../utils/date.js";
import { exportWordOneDocx } from "../export/wordDocx.js";
import { openReceiptPreview } from "../print/preview.js";

/* ===== Helpers ===== */
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;
const safeDMY = (d) => {
  try {
    const s = fmtDMY(d);
    // Nếu fmtDMY trả "Invalid Date" thì trả "-"
    return (s && !/invalid/i.test(String(s))) ? s : "-";
  } catch { return "-"; }
};

function goBackOneStepOrList() {
  if (sessionStorage.getItem("list.ui") && window.history.length > 1) {
    try { history.back(); return; } catch {}
  }
  location.hash = "#/list";
}

function ensureDetailKVStyles() {
  if (document.getElementById("detail-kv-style")) return;
  const css = `
    .kv{
      border:1px solid rgba(148,163,184,.25);
      border-radius:12px; padding:8px; margin-top:10px;
      background: rgba(148,163,184,.05);
    }
    .kv .row{
      display:flex; justify-content:space-between; align-items:center;
      padding:8px 6px; border-bottom:1px dashed rgba(148,163,184,.25);
      gap:12px;
    }
    .kv .row:last-child{ border-bottom:0; }
    .kv .key{ opacity:.85; }
    .kv .val{ font-weight:800; white-space:nowrap; font-variant-numeric: tabular-nums; }
    .kv .row.total .val{ font-size:18px; }
    .status-chip{
      display:inline-flex; align-items:center; gap:8px;
      padding:4px 10px; border-radius:999px; border:1px solid;
      font-weight:800; font-size:12px;
    }
    .paid { color:#065f46; background:#d1fae5; border-color:#34d399; }
    .unpaid{ color:#991b1b; background:#fee2e2; border-color:#f87171; }
    @media (max-width:480px){
      .kv .row{ padding:8px 4px; }
      .kv .row.total .val{ font-size:16px; }
    }
  `;
  const st = document.createElement("style");
  st.id = "detail-kv-style";
  st.textContent = css;
  document.head.appendChild(st);
}

/* ===== View ===== */
export function mount(el, idx) {
  ensureDetailKVStyles();

  const item = listResidents()[idx];
  if (!item) {
    el.innerHTML = `
      <div class="container">
        <div class="card"><h2>Không tìm thấy cư dân</h2></div>
      </div>`;
    return;
  }

  // Tính tiền + số liệu hiển thị
  const a = computeAmounts(item);
  const totalRounded = roundK(a.total);
  const paid = !!item.paid;
  const paidAtText = paid ? safeDMY(item.paidAt) : "-";

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <h2>Chi tiết cư dân • ${monthYearLabel()}</h2>
          <div class="toolbar">
            <a class="btn ghost" href="#/manage/${idx}">Quản lý</a>
            <a class="btn" href="#/list">Danh sách</a>
          </div>
        </div>

        <p class="helper">
          <b>Ngày ghi điện:</b> ${safeDMY(item.elecDate)}
          &nbsp;|&nbsp;
          <b>Ngày ghi nước:</b> ${safeDMY(item.waterDate)}
        </p>

        <p><b>Tên:</b> ${item.name || ""}</p>
        <p><b>Địa chỉ:</b> ${item.address || ""}</p>

        <p>
          <b>Điện</b> — cũ: ${item.oldElec} kWh • mới: ${item.newElec} kWh
          = <b>${a.elecUsage}</b> kWh = <b>${money(a.elecMoney)} đ</b>
        </p>
        <p>
          <b>Nước</b> — cũ: ${item.oldWater} m³ • mới: ${item.newWater} m³
          = <b>${a.waterUsage}</b> m³ = <b>${money(a.waterMoney)} đ</b>
        </p>

        <div class="kv">
          <div class="row"><span class="key">Tiền điện</span><span class="val">${money(a.elecMoney)} đ</span></div>
          <div class="row"><span class="key">Tiền nước</span><span class="val">${money(a.waterMoney)} đ</span></div>
          <div class="row"><span class="key">Nợ kỳ trước</span><span class="val">${money(Number(a.prevDebt || 0))} đ</span></div>
          <div class="row"><span class="key">Tạm ứng (đã thu)</span><span class="val">${money(Number(a.advance || 0))} đ</span></div>
          <div class="row"><span class="key"><b>Còn thiếu</b></span>
            <span class="val"><b>${money(Math.max(0, Number(a.remaining || 0)))} đ</b></span>
          </div>
          <div class="row total">
            <span class="key">
              <b>Tổng (đã làm tròn nghìn)</b>
              ${a.prevDebt ? `<span class="helper">(+ nợ cũ ${money(a.prevDebt)} đ)</span>` : ""}
            </span>
            <span class="val"><b>${money(totalRounded)} đ</b></span>
          </div>
        </div>

        <p class="helper" style="margin-top:8px">
          <span class="status-chip ${paid ? "paid" : "unpaid"}">
            ${paid ? "ĐÃ ĐÓNG" : "CHƯA ĐÓNG"}
          </span>
          &nbsp;|&nbsp; <b>Ngày đóng:</b> ${paidAtText}
        </p>

        <p class="helper" style="margin-top:4px">
          Quy tắc làm tròn: &ge; 500 làm tròn lên, &lt; 500 làm tròn xuống.
        </p>

        <div class="toolbar" style="justify-content:flex-end">
          <button class="btn" id="btnExportOne">Xuất Word (cá nhân)</button>
          <button class="btn secondary" id="btnPrint">In biên lai (58mm)</button>
          <button class="btn ghost" id="backBtn">Quay lại</button>
        </div>
      </div>
    </div>
  `;

  // Back (1 bước với fallback)
  el.querySelector("#backBtn").addEventListener("click", goBackOneStepOrList);

  // Xuất Word (một người)
  el.querySelector("#btnExportOne").addEventListener("click", () => {
    try { exportWordOneDocx(item); }
    catch (e) { alert("Xuất Word lỗi: " + (e?.message || e)); }
  });

  // In biên lai 58mm
  const btnPrint = el.querySelector("#btnPrint");
  btnPrint.addEventListener("click", () => {
    try {
      const shop = {
        name:  localStorage.getItem("shop_name")  || "ĐIỆN NƯỚC",
        addr:  localStorage.getItem("shop_addr")  || "",
        phone: localStorage.getItem("shop_phone") || ""
      };
      const bill = {
        monthLabel: monthYearLabel(),
        dOld: item.oldElec,  dNew: item.newElec,
        wOld: item.oldWater, wNew: item.newWater,
        kWh: a.elecUsage,    m3:  a.waterUsage,
        elec: a.elecMoney,   water: a.waterMoney,
        debt: a.prevDebt,    advance: a.advance,
        remain: a.remaining,
        total: totalRounded,
        date: new Date()
      };
      const resident = { name: item.name, address: item.address || "", prevDebt: a.prevDebt, advance: a.advance };
      openReceiptPreview({ shop, resident, bill });
    } catch (e) {
      alert("Không mở được màn hình in: " + (e?.message || e));
    }
  });
}

export default { mount };
