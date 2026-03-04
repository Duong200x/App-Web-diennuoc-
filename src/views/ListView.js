// src/views/listview.js
import {
  listResidents, updateInline, computeAmounts, setPaid,
  addAdvance, updateFull, recomputePrevDebtFromHistory
} from "../state/readings.js";
import { money } from "../utils/format.js";
import { exportExcel } from "../export/excel.js";
import { exportWordAllDocx } from "../export/wordDocx.js";
import { monthYearLabel } from "../utils/date.js";
import { enforceIntegerInput } from "../utils/numeric.js";
import { importResidentsFromXlsxToCurrent } from "../state/importResidents.js";
import { isInRoom, pushOneResident } from "../sync/room.js";
import { zoneLabel } from "../state/zones.js";
import { forceCarryOverToCurrentMonth } from "../state/history.js";

/* ======= UI state for List (scroll + keyword + zone + lastOid) ======= */
function rememberListUIState(rootEl, extras = {}) {
  try {
    const listWrap = rootEl.querySelector("#tbl")?.closest(".table-wrap");
    const state = {
      windowScrollY: window.pageYOffset || document.documentElement.scrollTop || 0,
      wrapScrollTop: listWrap ? listWrap.scrollTop : 0,
      keyword: rootEl.querySelector("#searchName")?.value || "",
      zone: rootEl.querySelector("#zoneFilter")?.value || "all",
      lastOid: extras.lastOid ?? null,
      ts: Date.now(),
    };
    sessionStorage.setItem("list.ui", JSON.stringify(state));
  } catch {}
}
function restoreListUIState(rootEl) {
  try {
    const raw = sessionStorage.getItem("list.ui");
    if (!raw) return;
    const st = JSON.parse(raw);
    const input = rootEl.querySelector("#searchName");
    if (input && st.keyword != null) {
      input.value = st.keyword;
      try { input.dispatchEvent(new Event("input")); } catch {}
    }
    const zSel = rootEl.querySelector("#zoneFilter");
    if (zSel && st.zone) {
      zSel.value = st.zone;
      try { zSel.dispatchEvent(new Event("change")); } catch {}
    }
    const doScroll = () => {
      if (Number.isFinite(st.windowScrollY)) window.scrollTo(0, st.windowScrollY);
      const listWrap = rootEl.querySelector("#tbl")?.closest(".table-wrap");
      if (listWrap && Number.isFinite(st.wrapScrollTop)) listWrap.scrollTop = st.wrapScrollTop;
    };
    requestAnimationFrame(() => requestAnimationFrame(doScroll));
    if (st.lastOid != null) {
      const tryHighlight = () => {
        const tr = rootEl.querySelector(`tr[data-oid="${st.lastOid}"]`);
        if (!tr) return;
        tr.classList.add("row-highlight");
        tr.scrollIntoView({ block: "center" });
        setTimeout(() => tr.classList.remove("row-highlight"), 2500);
      };
      requestAnimationFrame(tryHighlight);
    }
  } catch {}
}

/* làm tròn nghìn */
const roundK = (n) => Math.round((Number(n) || 0) / 1000) * 1000;

/* ===== Overlay xem nhanh số nhập ===== */
function ensurePreviewStyle() {
  if (document.getElementById("vp-style")) return;
  const css = `
  .value-preview{
    position:fixed; left:0; right:0; top:0;
    padding: calc(env(safe-area-inset-top, 0px) + 8px) 16px 12px 16px;
    display:none; z-index:1000;
    backdrop-filter: blur(6px);
    background: rgba(17,24,39,.6);
    color:#fff; font-size:18px;
  }
  .value-preview.show{ display:flex; justify-content:center; gap:10px; }
  .value-preview .label{ opacity:.9; font-weight:600; }
  .value-preview .val{ font-variant-numeric: tabular-nums; letter-spacing:.5px; }
  `;
  const st = document.createElement("style");
  st.id = "vp-style";
  st.textContent = css;
  document.head.appendChild(st);
}
function ensurePreviewEl() {
  ensurePreviewStyle();
  let el = document.getElementById("valuePreview");
  if (!el) {
    el = document.createElement("div");
    el.id = "valuePreview";
    el.className = "value-preview";
    document.body.appendChild(el);
  }
  return el;
}
function showPreview(label, val) {
  const pv = ensurePreviewEl();
  pv.innerHTML = `<span class="label">${label}:</span> <span class="val">${val ?? ""}</span>`;
  pv.classList.add("show");
}
function setPreview(val) {
  const pv = document.getElementById("valuePreview");
  if (pv) {
    const v = pv.querySelector(".val");
    if (v) v.textContent = String(val ?? "");
  }
}
function hidePreview() {
  const pv = document.getElementById("valuePreview");
  if (pv) pv.classList.remove("show");
}

/* ===== Styles bổ sung (bao gồm toggle) ===== */
function ensureListExtraStyles() {
  if (document.getElementById("list-money-fix-style")) return;
  const css = `
    @media (max-width: 480px) {
      .table td.c-elec,
      .table td.c-water,
      .table td.c-debt,
      .table td.c-adv,
      .table td.c-remain,
      .table td.c-total { font-size: clamp(12px, 3.6vw, 15px); }
      .table td.c-total b { font-size: inherit; }
      .table td.c-total .helper { font-size: 12px; white-space: normal; }
      .table td, .table th { padding: 8px 6px; }
      .table .input { max-width: 76px; text-align: center; }
    }
    .badge-paid{
      display:inline-flex; align-items:center; gap:6px;
      padding:4px 8px; border-radius:999px;
      font-weight:700; font-size:12px;
      color:#065f46; background:#d1fae5; border:1px solid #34d399;
      margin-right:8px;
    }
    .row-highlight{
      outline: 2px solid rgba(99,102,241,.55);
      background: rgba(99,102,241,.12);
      transition: background 1s ease;
    }
    tr.row-selected{ background: rgba(99,102,241,.08); }
    tr.row-selected td:first-child .row-link{
      font-weight:800; text-decoration:none;
    }
    /* Toggle (cần gạt) */
    .switch{
      display:inline-flex; align-items:center; gap:8px; user-select:none;
      font-size:14px;
    }
    .switch input{ position:absolute; opacity:0; width:0; height:0; }
    .switch .trk{
      width:42px; height:24px; border-radius:999px;
      background:#cbd5e1; position:relative; transition:background .18s ease;
      border:1px solid rgba(0,0,0,.08);
    }
    .switch .kn{
      position:absolute; top:2px; left:2px; width:20px; height:20px; border-radius:50%;
      background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.3); transition:left .18s ease;
    }
    .switch input:checked + .trk{ background:#10b981; }
    .switch input:checked + .trk .kn{ left:20px; }
  `;
  const st = document.createElement("style");
  st.id = "list-money-fix-style";
  st.textContent = css;
  document.head.appendChild(st);
}

/* ===== Tổng tiền block ===== */
function ensureSumStackStyles() {
  if (document.getElementById("sumstack-style")) return;
  const css = `
    .sumstack{ display:flex; flex-direction:column; gap:10px; margin:10px 0 6px; }
    .sum-row{
      display:flex; align-items:center; justify-content:space-between;
      padding:12px 14px; border-radius:14px;
      background: rgba(148,163,184,.08);
      border: 1px solid rgba(148,163,184,.22);
    }
    .sum-label{ font-size:14px; opacity:.9; }
    .sum-value{
      font-weight:800; font-variant-numeric: tabular-nums; letter-spacing:.3px;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
      font-size: clamp(22px, 7vw, 36px); line-height: 1.1;
    }
    .sum-row.total .sum-label{ font-weight:700; }
    .sum-row.total .sum-value{ font-size: clamp(24px, 8vw, 40px); }
    @media (min-width: 768px){ .sum-row{ padding:14px 16px; } }
  `;
  const st = document.createElement("style");
  st.id = "sumstack-style";
  st.textContent = css;
  document.head.appendChild(st);
}

/* =============================================================== */

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

/* ===== Suy luận KHU từ địa chỉ (fuzzy) ===== */
const vnCanon = (s) =>
  String(s || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const diceCoef = (a, b) => {
  a = vnCanon(a); b = vnCanon(b);
  if (!a || !b) return 0;
  const bigrams = (t) => {
    const arr = [];
    for (let i = 0; i < t.length - 1; i++) arr.push(t.slice(i, i + 2));
    return arr;
  };
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const map = new Map();
  for (const x of A) map.set(x, (map.get(x) || 0) + 1);
  let inter = 0;
  for (const x of B) {
    const c = map.get(x) || 0;
    if (c > 0) { inter++; map.set(x, c - 1); }
  }
  return (2 * inter) / (A.length + B.length);
};

const inferZoneFromAddress = (addr) => {
  const c = vnCanon(addr);
  if (/(khu\s*)?tren\b/.test(c)) return "tren";
  if (/(khu\s*)?giua\b/.test(c)) return "giua";
  if (/(khu\s*)?duoi\b/.test(c)) return "duoi";
  const cand = [
    ["tren", "khu tren"],
    ["giua", "khu giua"],
    ["duoi", "khu duoi"],
  ];
  let best = "khac", bestScore = 0;
  for (const [key, label] of cand) {
    const s = diceCoef(c, label);
    if (s > bestScore) { bestScore = s; best = key; }
  }
  return bestScore >= 0.75 ? best : "khac";
};

const smartZoneOf = (it) => {
  if (it.zone && it.zone !== "khac") return it.zone;
  if (it.address) return inferZoneFromAddress(it.address);
  return "khac";
};

/* =============================================================== */

export function mount(el) {
  try { recomputePrevDebtFromHistory(); } catch {}

  ensureSumStackStyles();
  ensureListExtraStyles();

  let all = listResidents();
  let current = [...all];
  let keyword = "";
  let zoneFilter = "all";

  const $ = (sel, root = el) => root.querySelector(sel);

  // helper: đọc trạng thái popup sao lưu (fallback nếu chưa inject BackupFab)
  const LS_ENABLED = "ui.backupFab.enabled";
  const getFabEnabled = () => {
    try {
      if (window.BackupFab && typeof window.BackupFab.getEnabled === "function") return !!window.BackupFab.getEnabled();
      const v = localStorage.getItem(LS_ENABLED);
      return v == null ? true : v === "1" || v === "true";
    } catch { return true; }
  };
  const setFabEnabled = (val) => {
    try {
      if (window.BackupFab && typeof window.BackupFab.setEnabled === "function") {
        window.BackupFab.setEnabled(!!val);
      } else {
        localStorage.setItem(LS_ENABLED, val ? "1" : "0");
        window.dispatchEvent(new Event("hashchange"));
      }
    } catch {}
  };

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <h2>Danh sách cư dân • ${monthYearLabel()}</h2>
          <div class="toolbar">
            <button class="btn danger" id="btnFixMonth" title="Sao lưu tháng trước và reset tháng hiện tại">Sửa tháng (reset)</button>
            <input type="file" id="impResidentFile" accept=".xlsx,.xls" style="display:none" />
            <button class="btn ghost" id="btnImportResidents">Nhập danh sách (Excel)</button>
            <button class="btn ghost" id="btnExcel">Xuất Excel</button>
            <button class="btn" id="btnWordAll">Xuất Word (tổng hợp)</button>
          </div>
        </div>

        <div class="toolbar" style="margin-top:4px; gap:8px;">
          <input id="searchName" class="input" placeholder="Tìm theo tên (gõ không dấu)" style="flex:1; min-width:220px">
          <select id="zoneFilter" class="input" style="width:auto">
            <option value="all">Khu: Tất cả</option>
            <option value="tren">Khu Trên</option>
            <option value="giua">Khu Giữa</option>
            <option value="duoi">Khu Dưới</option>
            <option value="khac">Khác</option>
          </select>

          <!-- Toggle nút nổi sao lưu -->
          <label class="switch" id="fabToggleWrap" title="Ẩn/hiện nút nổi Sao lưu/Khôi phục">
            <input type="checkbox" id="fabToggle">
            <span class="trk"><i class="kn"></i></span>
            <span>Popup sao lưu</span>
          </label>
        </div>

        <!-- ======= TỔNG TIỀN ======= -->
        <div class="sumstack" id="grandSum">
          <div class="sum-row"><div class="sum-label">Tiền điện tổng</div><div class="sum-value" id="sumElec">0</div></div>
          <div class="sum-row"><div class="sum-label">Tiền nước tổng</div><div class="sum-value" id="sumWater">0</div></div>
          <div class="sum-row"><div class="sum-label">Nợ cũ tổng</div><div class="sum-value" id="sumDebt">0</div></div>
          <div class="sum-row total"><div class="sum-label">Tổng cộng</div><div class="sum-value" id="sumAll">0</div></div>
        </div>

        <!-- ======= THEO KHU ======= -->
        <div class="table-wrap">
          <table class="table" id="zoneTotalsTbl">
            <thead>
              <tr><th colspan="4">Theo khu</th></tr>
              <tr>
                <th style="min-width:120px">Khu</th>
                <th>Tiền điện</th>
                <th>Tiền nước</th>
                <th>Tổng</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>

        <div class="spacer"></div>

        <!-- ======= DANH SÁCH CƯ DÂN ======= -->
        <div class="table-wrap">
          <table class="table" id="tbl">
            <thead>
              <tr>
                <th>Tên</th><th>Địa chỉ</th>
                <th>Điện cũ</th><th>Nước cũ</th>
                <th>Điện mới</th><th>Nước mới</th>
                <th>Tiền điện</th><th>Tiền nước</th><th>Nợ cũ</th>
                <th>Đã thu</th><th>Còn thiếu</th>
                <th>Tổng</th>
                <th>Hành động</th>
              </tr>
            </thead>
            <tbody></tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  // Khởi tạo trạng thái toggle từ BackupFab/localStorage
  const toggle = $("#fabToggle");
  try { toggle.checked = !!getFabEnabled(); } catch {}
  toggle.addEventListener("change", () => setFabEnabled(toggle.checked));
  // Đồng bộ nếu thay đổi từ nơi khác
  window.addEventListener("backupfab:enabled-changed", (e) => {
    try { toggle.checked = !!(e.detail); } catch {}
  });

  const tbody = $("#tbl tbody");
  const zoneBody = $("#zoneTotalsTbl tbody");
  const sumElecEl = $("#sumElec");
  const sumWaterEl = $("#sumWater");
  const sumDebtEl = $("#sumDebt");
  const sumAllEl = $("#sumAll");

  const computeSummary = (rows) =>
    rows.reduce(
      (acc, it) => {
        const { elecMoney, waterMoney, total, prevDebt } = computeAmounts(it);
        acc.elec += elecMoney || 0;
        acc.water += waterMoney || 0;
        acc.debt += Number(prevDebt || 0);
        acc.totalRounded += roundK(total || 0);
        return acc;
      },
      { elec: 0, water: 0, debt: 0, totalRounded: 0 }
    );

  const computeZoneSummary = (rows) => {
    const b = { tren:{e:0,w:0,all:0,count:0}, giua:{e:0,w:0,all:0,count:0}, duoi:{e:0,w:0,all:0,count:0} };
    for (const it of rows) {
      const { elecMoney, waterMoney, total } = computeAmounts(it);
      const k = smartZoneOf(it);
      if (!b[k]) continue;
      b[k].e += elecMoney || 0;
      b[k].w += waterMoney || 0;
      b[k].all += roundK(total || 0);
      b[k].count++;
    }
    return b;
  };

  const updateGrandSummary = (rows) => {
    const s = computeSummary(rows);
    sumElecEl.textContent  = money(s.elec);
    sumWaterEl.textContent = money(s.water);
    sumDebtEl.textContent  = money(s.debt);
    sumAllEl.textContent   = money(s.totalRounded);
  };

  const renderZoneTotals = (rows) => {
    const b = computeZoneSummary(rows);
    const order = ["tren", "giua", "duoi"];
    const trs = [];
    for (const k of order) {
      const z = b[k];
      if (!z || !z.count) continue;
      trs.push(`
        <tr>
          <td>${zoneLabel(k)}</td>
          <td><b>${money(z.e)}</b></td>
          <td><b>${money(z.w)}</b></td>
          <td><b>${money(z.all)}</b></td>
        </tr>
      `);
    }
    zoneBody.innerHTML = trs.length ? trs.join("") :
      `<tr><td colspan="4" class="center" style="opacity:.7;padding:10px 0">Chưa có dữ liệu khu.</td></tr>`;
  };

  const renderRows = (rows) => {
    updateGrandSummary(rows);
    renderZoneTotals(rows);

    const bodyHtml =
      rows.map((it) => {
        const oid = all.indexOf(it);
        const { elecMoney, waterMoney, total, prevDebt, advance, remaining } = computeAmounts(it);
        const totalRounded = roundK(total);
        const disableAdvance = remaining <= 0;

        const actionsHtml = it.paid
          ? `<span class="badge-paid">ĐÃ ĐÓNG</span><a class="btn secondary" href="#/manage/${oid}">Quản lý</a>`
          : `
            <label class="chk-paid" style="display:inline-flex;align-items:center;gap:6px;margin-right:8px;">
              <input type="checkbox" class="mark-paid" ${it.paid ? "checked" : ""}>
              Đã đóng
            </label>
            <button class="btn ghost btn-adv" ${disableAdvance ? "disabled" : ""}>Thu tạm ứng</button>
            <button class="btn ghost btn-adv-edit">Sửa số đã thu</button>
            <button class="btn ghost btn-edit">Chỉnh sửa</button>
            <a class="btn secondary" href="#/manage/${oid}">Quản lý</a>
          `;

        const zSmart = smartZoneOf(it);
        const place = zSmart !== "khac" ? zoneLabel(zSmart) : (it.address || "");

        return `
          <tr data-oid="${oid}">
            <td>
              <a class="row-link" href="#/detail/${oid}">${it.name}</a>
            </td>
            <td>${place}</td>
            <td>${it.oldElec}</td>
            <td>${it.oldWater}</td>
            <td class="c-new-elec">${it.newElec}</td>
            <td class="c-new-water">${it.newWater}</td>
            <td class="c-elec">${money(elecMoney)}</td>
            <td class="c-water">${money(waterMoney)}</td>
            <td class="c-debt">${money(Number(prevDebt || 0))}</td>
            <td class="c-adv">${money(Number(advance || 0))}</td>
            <td class="c-remain"><b>${money(Number(remaining || 0))}</b></td>
            <td class="c-total">
              <b>${money(totalRounded)}</b>
              ${prevDebt ? `<div class="helper">(+ nợ cũ ${money(prevDebt)})</div>` : ""}
            </td>
            <td class="actions">${actionsHtml}</td>
          </tr>
        `;
      }).join("") ||
      `<tr><td colspan="13" class="center" style="padding:24px;">
        Chưa có cư dân. <a href="#/add" class="btn" style="margin-left:8px;">Thêm cư dân</a>
      </td></tr>`;

    const listWrap = el.querySelector("#tbl")?.closest(".table-wrap");
    const curTop = listWrap ? listWrap.scrollTop : 0;
    tbody.innerHTML = bodyHtml;
    if (listWrap) listWrap.scrollTop = curTop;

    /* ====== Hành vi CHẠM HÀNG ====== */
    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", (e) => {
        if (e.target.closest("a, button, input, label")) return;
        if (tr.classList.contains("row-selected")) { tr.classList.remove("row-selected"); return; }
        tbody.querySelectorAll("tr.row-selected").forEach(r => r.classList.remove("row-selected"));
        tr.classList.add("row-selected");
      });
    });

    /* ====== Hành động ====== */
    tbody.querySelectorAll(".mark-paid").forEach((cb) => {
      cb.addEventListener("change", async () => {
        const tr = cb.closest("tr");
        const oid = Number(tr.dataset.oid);
        try {
          await setPaid(oid, cb.checked);
          if (isInRoom()) await pushOneResident(listResidents()[oid]);
          all = listResidents();
          current = applyFilter();
          renderRows(current);
        } catch (e) {
          alert("Lỗi cập nhật trạng thái thanh toán: " + (e?.message || e));
          cb.checked = !cb.checked;
        }
      });
    });

    tbody.querySelectorAll('a[href^="#/"], .actions a[href^="#/"]').forEach((a) => {
      a.addEventListener("click", (ev) => {
        const tr = ev.currentTarget.closest("tr");
        const lastOid = tr ? Number(tr.dataset.oid) : null;
        rememberListUIState(el, { lastOid });
      });
    });

    // Thu tạm ứng
    tbody.querySelectorAll(".btn-adv").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const oid = Number(tr.dataset.oid);
        const it = listResidents()[oid];
        const a = computeAmounts(it);
        const remaining = a.remaining;
        if (remaining <= 0) { alert("Không còn số tiền cần tạm ứng."); return; }

        const raw = prompt(`Nhập số tiền thu tạm ứng (Còn thiếu hiện tại: ${money(remaining)}):`, "");
        if (raw == null) return;
        const amount = Number(String(raw).replace(/[^\d]/g, "")) || 0;
        if (amount <= 0) { alert("Số tiền không hợp lệ."); return; }

        try {
          await addAdvance(oid, amount);
          if (isInRoom()) await pushOneResident(listResidents()[oid]);
          all = listResidents();
          current = applyFilter();
          renderRows(current);
        } catch (err) {
          alert(err?.message || err);
        }
      });
    });

    // Sửa số đã thu
    tbody.querySelectorAll(".btn-adv-edit").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const tr = btn.closest("tr");
        const oid = Number(tr.dataset.oid);
        const it = listResidents()[oid];
        const a = computeAmounts(it);

        const raw = prompt(
          `Nhập lại số đã thu (tổng kỳ này: ${money(a.total)}).\nNhập 0 nếu muốn xóa tạm ứng:`,
          String(it.advance || 0)
        );
        if (raw == null) return;
        const val = Number(String(raw).replace(/[^\d]/g, "")) || 0;
        try {
          const willPaid = val >= a.total;
          await updateFull(oid, { advance: val, paid: willPaid });
          if (isInRoom()) await pushOneResident(listResidents()[oid]);
          all = listResidents();
          current = applyFilter();
          renderRows(current);
        } catch (err) {
          alert(err?.message || err);
        }
      });
    });

    // Chỉnh sửa inline + overlay
    tbody.querySelectorAll(".btn-edit").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const oid = Number(tr.dataset.oid);
        const tdNE = tr.querySelector(".c-new-elec");
        const tdNW = tr.querySelector(".c-new-water");
        const tdElec = tr.querySelector(".c-elec");
        const tdWater = tr.querySelector(".c-water");
        const tdDebt  = tr.querySelector(".c-debt");
        const tdAdv   = tr.querySelector(".c-adv");
        const tdRem   = tr.querySelector(".c-remain");
        const tdTotal = tr.querySelector(".c-total");
        const oldNE = tdNE.textContent.trim();
        const oldNW = tdNW.textContent.trim();

        tr.scrollIntoView({ block: "center", behavior: "smooth" });

        tdNE.innerHTML = `<input class="input" type="text" inputmode="numeric" pattern="[0-9]*" value="${oldNE}">`;
        tdNW.innerHTML = `<input class="input" type="text" inputmode="numeric" pattern="[0-9]*" value="${oldNW}">`;

        const actions = tr.querySelector(".actions");
        const paidNow = (listResidents()[oid] || {}).paid ? "checked" : "";
        actions.innerHTML = `
          <label class="chk-paid" style="display:inline-flex;align-items:center;gap:6px;margin-right:8px;">
            <input type="checkbox" class="mark-paid" ${paidNow} disabled>
            Đã đóng
          </label>
          <button class="btn secondary btn-cancel">Hủy</button>
          <button class="btn btn-save">Lưu</button>
        `;

        const inpE = tdNE.querySelector("input");
        const inpW = tdNW.querySelector("input");
        enforceIntegerInput(inpE);
        enforceIntegerInput(inpW);

        const onFocusE = () => showPreview("Điện mới", inpE.value);
        const onFocusW = () => showPreview("Nước mới", inpW.value);
        inpE.addEventListener("focus", onFocusE);
        inpW.addEventListener("focus", onFocusW);
        inpE.addEventListener("blur", hidePreview);
        inpW.addEventListener("blur", hidePreview);

        const preview = () => {
          const arr = listResidents();
          const it = arr[oid];
          const next = {
            ...it,
            newElec: Number(inpE.value || 0),
            newWater: Number(inpW.value || 0),
            advance: it.advance || 0,
            prevDebt: it.prevDebt || 0,
          };
          const { elecMoney, waterMoney, total, prevDebt, advance, remaining } = computeAmounts(next);
          const totalRounded = roundK(total);

          tdElec.textContent = money(elecMoney);
          tdWater.textContent = money(waterMoney);
          tdDebt.textContent  = money(prevDebt || 0);
          tdAdv.textContent   = money(advance || 0);
          tdRem.innerHTML     = `<b>${money(remaining || 0)}</b>`;
          tdTotal.innerHTML   = `<b>${money(totalRounded)}</b>${next.prevDebt ? `<div class="helper">(+ nợ cũ ${money(prevDebt)})</div>` : ""}`;

          if (document.activeElement === inpE) setPreview(inpE.value);
          if (document.activeElement === inpW) setPreview(inpW.value);

          const rows2 = current.map((r) => (r === it ? next : r));
          updateGrandSummary(rows2);
          renderZoneTotals(rows2);
        };
        inpE.addEventListener("input", preview);
        inpW.addEventListener("input", preview);

        const keyHandler = (e) => {
          if (e.key === "Enter") actions.querySelector(".btn-save").click();
          if (e.key === "Escape") actions.querySelector(".btn-cancel").click();
        };
        inpE.addEventListener("keydown", keyHandler);
        inpW.addEventListener("keydown", keyHandler);

        inpE.focus(); inpE.select();
        showPreview("Điện mới", inpE.value);
        preview();

        actions.querySelector(".btn-cancel").addEventListener("click", () => {
          hidePreview();
          renderRows(current);
        });

        actions.querySelector(".btn-save").addEventListener("click", async () => {
          try {
            await updateInline(oid, {
              newElec: Number(inpE.value || 0),
              newWater: Number(inpW.value || 0),
            });
            if (isInRoom()) await pushOneResident(listResidents()[oid]);
            hidePreview();
            all = listResidents();
            current = applyFilter();
            renderRows(current);
          } catch (err) {
            alert(err.message || err);
          }
        });
      });
    });

    window.__restoreListFocus?.();
  };

  const applyFilter = () => {
    const q = norm(keyword);
    return all.filter((r) => {
      const byName = q ? norm(r.name).includes(q) : true;
      const byZone = zoneFilter === "all" ? true : (smartZoneOf(r) === zoneFilter);
      return byName && byZone;
    });
  };

  // render đầu tiên
  renderRows(current);
  restoreListUIState(el);

  // Nhớ trạng thái khi cuộn & khi đổi route
  (function(){
    let t;
    window.addEventListener("scroll", () => {
      clearTimeout(t);
      t = setTimeout(() => rememberListUIState(el), 120);
    }, { passive: true });

    const listWrap = el.querySelector("#tbl")?.closest(".table-wrap");
    if (listWrap) {
      let t2;
      listWrap.addEventListener("scroll", () => {
        clearTimeout(t2);
        t2 = setTimeout(() => rememberListUIState(el), 120);
      });
    }

    window.addEventListener("hashchange", () => rememberListUIState(el));
  })();

  // search
  document.getElementById("searchName").addEventListener("input", (e) => {
    keyword = e.target.value;
    current = applyFilter();
    renderRows(current);
    rememberListUIState(el);
  });

  // zone filter
  const zSel = document.getElementById("zoneFilter");
  zSel.addEventListener("change", () => {
    zoneFilter = zSel.value || "all";
    current = applyFilter();
    renderRows(current);
    rememberListUIState(el);
  });

  // ======= Sửa tháng (reset) =======
  const btnFix = document.getElementById("btnFixMonth");
  btnFix.addEventListener("click", async () => {
    const ok = confirm(
      'Hành động này sẽ:\n' +
      '• Sao lưu bảng hiện tại thành lịch sử THÁNG TRƯỚC\n' +
      '• Reset bảng THÁNG HIỆN TẠI: old = new tháng trước; new = 0; nợ cũ giữ nguyên\n\n' +
      'Bạn có chắc muốn tiếp tục?'
    );
    if (!ok) return;
    try {
      const r = forceCarryOverToCurrentMonth();
      alert(`Đã lưu ${r.rows} dòng vào lịch sử ${r.savedMonth} và reset tháng ${r.currentMonth}`);
      if (isInRoom()) for (const it of listResidents()) await pushOneResident(it);
      all = listResidents();
      current = applyFilter();
      renderRows(current);
    } catch (e) {
      alert("Lỗi sửa tháng: " + (e?.message || e));
    }
  });

  // Import Excel
  const btnImp = document.getElementById("btnImportResidents");
  const inpImp = document.getElementById("impResidentFile");
  btnImp.addEventListener("click", () => inpImp.click());
  inpImp.addEventListener("change", async () => {
    const f = inpImp.files?.[0];
    if (!f) return;
    try {
      const res = await importResidentsFromXlsxToCurrent(f);
      alert(`Đã nhập: ${res.total} cư dân\n- Mới: ${res.added}\n- Cập nhật: ${res.updated}`);
      if (isInRoom()) for (const it of listResidents()) await pushOneResident(it);
      all = listResidents();
      current = applyFilter();
      renderRows(current);
    } catch (err) {
      alert("Lỗi nhập danh sách: " + (err.message || err));
    } finally {
      inpImp.value = "";
    }
  });

  // Export
  const btnExcel = document.getElementById("btnExcel");
  const btnWordAll = document.getElementById("btnWordAll");
  if (!all.length) {
    btnExcel.setAttribute("disabled", "true");
    btnWordAll.setAttribute("disabled", "true");
  } else {
    btnExcel.addEventListener("click", () => exportExcel(listResidents()));
    btnWordAll.addEventListener("click", () => exportWordAllDocx(listResidents()));
  }

  /* ================= Auto-refresh + Focus guard ================= */
  (function setupListFocusGuard() {
    const KEY = "list.focus.guard";
    function makeRowKey(el) {
      const row = el.closest("tr[data-oid]") || el.closest("tr");
      return row?.getAttribute("data-oid") || "";
    }
    function saveFocus(el) {
      try {
        if (!el || !(el instanceof HTMLElement)) return;
        if (!/(input|textarea|select)/i.test(el.tagName)) return;
        const data = {
          tag: el.tagName.toLowerCase(),
          type: el.getAttribute("type") || "",
          name: el.getAttribute("name") || "",
          rowKey: makeRowKey(el),
          value: (el.value ?? ""),
          start: el.selectionStart ?? null,
          end: el.selectionEnd ?? null,
        };
        sessionStorage.setItem(KEY, JSON.stringify(data));
      } catch {}
    }
    function matches(el, snap) {
      if (!el || !snap) return false;
      if (el.tagName.toLowerCase() !== snap.tag) return false;
      const rk = makeRowKey(el);
      if (snap.rowKey && rk && rk === snap.rowKey) return true;
      const sameName = !!snap.name && el.getAttribute("name") === snap.name;
      const sameType = (el.getAttribute("type") || "") === (snap.type || "");
      return (sameName && sameType);
    }
    function restoreFocus() {
      try {
        const raw = sessionStorage.getItem(KEY);
        if (!raw) return;
        const snap = JSON.parse(raw);
        const cands = Array.from(document.querySelectorAll("#tbl input, #tbl textarea, #tbl select"));
        const el = cands.find((e) => matches(e, snap));
        if (!el) return;
        el.focus({ preventScroll: true });
        const len = String(el.value ?? "").length;
        const s = Math.max(0, Math.min(len, snap.start ?? len));
        const e = Math.max(0, Math.min(len, snap.end ?? len));
        try { el.setSelectionRange?.(s, e); } catch {}
      } catch {}
    }
    document.addEventListener("focusin", (e) => saveFocus(e.target));
    document.addEventListener("keyup",   (e) => saveFocus(e.target));
    document.addEventListener("input",   (e) => saveFocus(e.target));
    window.__restoreListFocus = restoreFocus;
  })();

  (function setupListAutoRefresh() {
    function calcHash(xs) {
      try { return btoa(unescape(encodeURIComponent(JSON.stringify(xs)))); }
      catch { return JSON.stringify(xs) || ""; }
    }
    let lastHash = calcHash(listResidents() || []);
    const INTERVAL = 650;

    (function tick() {
      try {
        const active = document.activeElement;
        if (active && active.closest && active.closest("#tbl") && /^(input|textarea|select)$/i.test(active.tagName)) {
          return void setTimeout(tick, INTERVAL);
        }
        const currAll = listResidents() || [];
        const h = calcHash(currAll);
        if (h !== lastHash) {
          lastHash = h;
          rememberListUIState(el);
          all = currAll;
          current = applyFilter();
          renderRows(current);
        }
      } catch {}
      setTimeout(tick, INTERVAL);
    })();
  })();
}
