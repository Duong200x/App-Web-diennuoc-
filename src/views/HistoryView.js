// src/views/historyviews.js
import { getJSON, setJSON, setStr, KEYS } from "../state/storage.js";
import { computeAmounts, recomputePrevDebtFromHistory, updateHistoryRow } from "../state/readings.js";
import { money } from "../utils/format.js";
import { labelFromMonthKey, getCurrentMonth } from "../utils/date.js";
import { importHistoryMonth } from "../state/history.js";
import { parseHistoryXlsx, parseHistoryCsv } from "../state/xlsxImport.js";
import { zoneLabel } from "../state/zones.js";
import { isInRoom, pushHistoryAll } from "../sync/room.js";
import { exportExcel } from "../export/excel.js";

/* ================== UI state & helpers ================== */
function rememberHistoryUIState(rootEl) {
  try {
    const wrap = rootEl.querySelector(".table-wrap");
    const ui = {
      year: rootEl.querySelector("#yearSel")?.value || "all",
      month: rootEl.querySelector("#monthSel")?.value || "all",
      scrollTop: wrap ? wrap.scrollTop : 0,
      selectedKey: sessionStorage.getItem("history.selectedKey") || null,
    };
    sessionStorage.setItem("history.ui", JSON.stringify(ui));
  } catch {}
}
function restoreHistoryUIState(rootEl) {
  try {
    const raw = sessionStorage.getItem("history.ui");
    if (!raw) return;
    const ui = JSON.parse(raw);
    const ySel = rootEl.querySelector("#yearSel");
    const mSel = rootEl.querySelector("#monthSel");
    if (ySel && ui.year) ySel.value = ui.year;
    if (mSel && ui.month) mSel.value = ui.month;

    // reselect row
    if (ui.selectedKey) {
      const row = rootEl.querySelector(`.history-row[data-key="${ui.selectedKey}"]`);
      if (row) row.classList.add("is-selected");
    }
    // restore scroll
    const wrap = rootEl.querySelector(".table-wrap");
    if (wrap && Number.isFinite(ui.scrollTop)) wrap.scrollTop = ui.scrollTop;
  } catch {}
}
function enableWebWide(rootEl) {
  try {
    const isNative =
      window.Capacitor && typeof window.Capacitor.isNativePlatform === "function"
        ? window.Capacitor.isNativePlatform()
        : false;
    if (isNative) return;
    rootEl.querySelectorAll(".table-wrap").forEach((wrap) => {
      wrap.style.overflowX = "visible";
      const table = wrap.querySelector("table.table");
      if (table) {
        table.style.minWidth = "0";
        table.style.tableLayout = "auto";
      }
    });
  } catch {}
}

/* ====== Preview số ====== */
function ensurePreviewEl() {
  let pv = document.getElementById("valuePreview");
  if (!pv) {
    pv = document.createElement("div");
    pv.id = "valuePreview";
    pv.style.position = "fixed";
    pv.style.zIndex = "9999";
    pv.style.padding = "6px 10px";
    pv.style.borderRadius = "10px";
    pv.style.boxShadow = "0 6px 18px rgba(0,0,0,.18)";
    pv.style.fontWeight = "700";
    pv.style.fontSize = "14px";
    pv.style.pointerEvents = "none";
    pv.style.display = "none";
    document.body.appendChild(pv);
  }
  return pv;
}
function setPreviewTheme(pv) {
  const dark = document.documentElement.classList.contains("theme-dark");
  pv.style.background = dark ? "#0f172a" : "#111827";
  pv.style.color = dark ? "#e5e7eb" : "#f9fafb";
  pv.style.border = dark ? "1px solid #334155" : "1px solid #374151";
}
function showPreviewForInput(inputEl) {
  const pv = ensurePreviewEl();
  setPreviewTheme(pv);
  const rect = inputEl.getBoundingClientRect();
  pv.textContent = formatNum(inputEl.value);
  pv.style.left = `${rect.left}px`;
  pv.style.top = `${Math.max(0, rect.top - 34)}px`;
  pv.style.display = "block";
}
function movePreviewForInput(inputEl) {
  const pv = document.getElementById("valuePreview");
  if (!pv || pv.style.display === "none") return;
  pv.textContent = formatNum(inputEl.value);
  const rect = inputEl.getBoundingClientRect();
  pv.style.left = `${rect.left}px`;
  pv.style.top = `${Math.max(0, rect.top - 34)}px`;
}
function hidePreview() {
  const pv = document.getElementById("valuePreview");
  if (pv) pv.style.display = "none";
}

/* ================== helpers ================== */
const nowMonth = () => getCurrentMonth(); // "YYYY-MM"
const isFutureMonth = (mk) => /^\d{4}-\d{2}$/.test(mk) && mk > nowMonth();
const toNum = (s) => Number(String(s || "0").replace(/[^\d.-]/g, "")) || 0;
const formatNum = (v) => {
  const n = toNum(v);
  return Number.isFinite(n) ? n.toLocaleString("vi-VN") : String(v ?? "");
};

/* ====== Styles cho footer tổng tháng ====== */
function ensureHistorySumStyles() {
  if (document.getElementById("history-sum-style")) return;
  const css = `
    .month-sum .sum-title{
      text-align:right; font-weight:700; opacity:.9; padding-right:12px;
      white-space:nowrap;
    }
    .sum-footer{
      display:flex; flex-wrap:wrap; gap:10px; align-items:center;
      padding:8px 0;
    }
    .sum-chip{
      display:flex; align-items:center; gap:8px;
      background: var(--chip-bg);
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 6px 10px;
      font-size: 14px;
    }
    .sum-chip .lab{ opacity:.8; font-weight:600; }
    .sum-chip .val{ font-weight:800; font-variant-numeric: tabular-nums; }
    .sum-chip.total{
      background: rgba(76, 141, 255, .08);
      border-color: rgba(76, 141, 255, .25);
    }
    .theme-dark .sum-chip.total{
      background: rgba(76,141,255,.12);
      border-color: rgba(76,141,255,.35);
    }
    tfoot .month-sum th, tfoot .month-sum td{
      border-top: 2px solid var(--border);
    }
  `;
  const st = document.createElement("style");
  st.id = "history-sum-style";
  st.textContent = css;
  document.head.appendChild(st);
}

/* ========= small util để hash object cho auto-refresh ========= */
function calcHash(obj) {
  try {
    return btoa(unescape(encodeURIComponent(JSON.stringify(obj))));
  } catch {
    return JSON.stringify(obj) || "";
  }
}

/* ================== mount ================== */
export function mount(el) {
  ensureHistorySumStyles();

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <h2>Lịch sử</h2>
          <div class="toolbar">
            <select id="yearSel" class="input" style="width:auto"></select>
            <select id="monthSel" class="input" style="width:auto"></select>
            <button class="btn" id="apply">Áp dụng</button>
          </div>
        </div>

        <div style="margin:10px 0; display:flex; gap:10px; align-items:center; flex-wrap:wrap">
          <input id="impFile" class="input" type="file" accept=".xlsx,.xls,.csv" style="max-width:280px">
          <input id="impMonth" class="input" placeholder="Tháng đích (ví dụ 2025-06) - nếu CSV không có cột tháng" style="width:260px">
          <button id="btnImport" class="btn secondary">Nhập Excel/CSV</button>
          <span id="impStatus" class="helper"></span>
        </div>

        <div id="cards"></div>
      </div>
    </div>
  `;

  function fillFilterOptions(history, keepSelection = true) {
    const yearSel = el.querySelector("#yearSel");
    const monthSel = el.querySelector("#monthSel");
    const prevY = keepSelection ? (yearSel.value || "all") : "all";
    const prevM = keepSelection ? (monthSel.value || "all") : "all";

    const months = Object.keys(history).sort((a, b) => b.localeCompare(a));
    const years = Array.from(new Set(months.map((k) => k.split("-")[0]))).sort((a, b) =>
      b.localeCompare(a)
    );

    yearSel.innerHTML =
      `<option value="all">Năm: Tất cả</option>` +
      years.map((y) => `<option value="${y}">${y}</option>`).join("");

    monthSel.innerHTML =
      `<option value="all">Tháng: Tất cả</option>` +
      Array.from({ length: 12 }, (_, i) => i + 1)
        .map((m) => `<option value="${String(m).padStart(2, "0")}">${m}</option>`)
        .join("");

    yearSel.value = years.includes(prevY) ? prevY : "all";
    monthSel.value = /^[0-1]\d$/.test(prevM) ? prevM : "all";
  }

  function render() {
    const history = getJSON(KEYS.history, {});
    fillFilterOptions(history, true);
    const months = Object.keys(history).sort((a, b) => b.localeCompare(a));

    const y = el.querySelector("#yearSel").value || "all";
    const m = el.querySelector("#monthSel").value || "all";

    const filter = (k) => {
      const [yr, mo] = k.split("-");
      if (y !== "all" && y !== yr) return false;
      if (m !== "all" && m !== mo) return false;
      return true;
    };

    const wrap = el.querySelector("#cards");
    wrap.innerHTML = months
      .filter(filter)
      .map((k) => {
        const rows = (history[k] || []).slice();

        // ====== Tính tổng tháng + build tbody
        let sumElec = 0,
          sumWater = 0,
          sumAdv = 0,
          sumDebt = 0,
          sumTotal = 0;
        const tbodyHtml = rows
          .map((it, idx) => {
            // Tiền điện / nước của tháng
            const elec = Number.isFinite(it.__elec)
              ? Number(it.__elec || 0)
              : computeAmounts(it).elecMoney;

            const water = Number.isFinite(it.__water)
              ? Number(it.__water || 0)
              : computeAmounts(it).waterMoney;

            // Tạm ứng đã thu trong tháng đó (snapshot)
            const advSnap = Number.isFinite(it.__advance)
              ? Number(it.__advance || 0)
              : Math.max(0, Number(it.advance || 0));

            // Nợ = nợ cũ chuyển sang từ THÁNG TRƯỚC
            const debt = Math.max(0, Number(it.prevDebt || 0));

            // Tổng gốc = tiền tháng này + nợ cũ
            const rawTotal = elec + water + debt;

            // Số còn phải thu sau khi TRỪ tạm ứng
            const remaining = Math.max(rawTotal - advSnap, 0);

            // Hiển thị:
            // - Nếu đã đóng: giữ nguyên tổng gốc
            // - Nếu CHƯA đóng: hiển thị số còn phải thu
            const total = it.paid ? rawTotal : remaining;

            // Cộng dồn cho footer
            sumElec += elec;
            sumWater += water;
            sumAdv += advSnap;
            sumDebt += debt;
            sumTotal += total;

            const place =
              it.zone && it.zone !== "khac" ? zoneLabel(it.zone) : it.address || "";

            return `
              <tr class="history-row" data-idx="${idx}" data-key="${k}:${idx}">
                <td>${it.name || ""}</td>
                <td>${place || ""}</td>
                <td>${it.oldElec ?? ""}</td>
                <td>${it.newElec ?? ""}</td>
                <td>${it.oldWater ?? ""}</td>
                <td>${it.newWater ?? ""}</td>
                <td>${money(elec)}</td>
                <td>${money(water)}</td>
                <!-- Tạm ứng: hiển thị như ô bình thường, KHÔNG cho nhập -->
                <td style="text-align:right; white-space:nowrap">
                  ${money(advSnap)}
                </td>
                <!-- Nợ: nợ cũ từ tháng trước -->
                <td style="text-align:right; white-space:nowrap">
                  ${money(debt)}
                </td>
                <!-- Tổng: đã trừ tạm ứng nếu CHƯA đóng -->
                <td><b>${money(total)}</b></td>
                <!-- Cột trạng thái: cho chỉnh Đã đóng/Chưa đóng -->
                <td style="white-space:nowrap">
                  <label style="display:inline-flex;align-items:center;gap:6px">
                    <input type="checkbox" class="chk-paid" ${
                      it.paid ? "checked" : ""
                    }> Đã đóng
                  </label>
                  <button class="btn ghost btn-save" style="margin-left:8px">Lưu</button>
                </td>
              </tr>
            `;
          })
          .join("");

        const monthLabel = labelFromMonthKey(k);

        return `
          <div class="spacer"></div>
          <div class="card" data-month="${k}">
            <div class="toolbar" style="justify-content:space-between; flex-wrap:wrap; gap:10px">
              <div style="display:flex; align-items:center; gap:10px">
                <h3>${monthLabel}</h3>
                <input type="text" class="input search-month" placeholder="Tìm tên/phòng..." style="font-size:14px; padding:4px 8px; width:160px">
              </div>
              <div class="toolbar">
                <button class="btn secondary btn-del-month">Xóa bảng tháng</button>
                <button class="btn btn-excel-month">In Excel</button>
              </div>
            </div>
            <div class="table-wrap">
              <table class="table">
                <thead>
                  <tr>
                    <th>Tên</th><th>Địa chỉ/Khu</th>
                    <th>Điện cũ</th><th>Điện mới</th>
                    <th>Nước cũ</th><th>Nước mới</th>
                    <th>Tiền điện</th><th>Tiền nước</th>
                    <th>Tạm ứng</th><th>Nợ</th><th>Tổng</th><th>Hành động</th>
                  </tr>
                </thead>
                <tbody>${tbodyHtml}</tbody>
                <tfoot>
                  <tr class="month-sum">
                    <th class="sum-title" colspan="6">Tổng tháng ${monthLabel}</th>
                    <td colspan="6">
                      <div class="sum-footer">
                        <div class="sum-chip"><span class="lab">Điện</span><span class="val">${money(
                          sumElec
                        )}</span></div>
                        <div class="sum-chip"><span class="lab">Nước</span><span class="val">${money(
                          sumWater
                        )}</span></div>
                        <div class="sum-chip"><span class="lab">Nợ</span><span class="val">${money(
                          sumDebt
                        )}</span></div>
                        <div class="sum-chip total"><span class="lab">Tổng cộng</span><span class="val">${money(
                          sumTotal
                        )}</span></div>
                      </div>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        `;
      })
      .join("");

    // Chọn hàng (highlight + nhớ)
    wrap.querySelectorAll("tbody").forEach((tbody) => {
      tbody.addEventListener("click", (e) => {
        const tr = e.target.closest(".history-row");
        if (!tr) return;
        if (e.target.closest(".btn-save")) return;
        wrap
          .querySelectorAll(".history-row.is-selected")
          .forEach((r) => r.classList.remove("is-selected"));
        tr.classList.add("is-selected");
        const mk = tr.closest(".card")?.dataset?.month || "";
        const idx = tr.dataset.idx;
        const key = `${mk}:${idx}`;
        sessionStorage.setItem("history.selectedKey", key);
      });
    });

    // Preview số (không còn input tạm ứng/nợ, nên thực tế không chạy)
    function attachPreviewHandlers(scope) {
      scope.querySelectorAll(".inp-adv, .inp-debt").forEach((inp) => {
        inp.addEventListener("focus", () => showPreviewForInput(inp));
        inp.addEventListener("input", () => movePreviewForInput(inp));
        inp.addEventListener("blur", hidePreview);
      });
    }
    attachPreviewHandlers(wrap);

    // Xuất Excel theo từng tháng
    wrap.querySelectorAll(".btn-excel-month").forEach((btn) => {
      btn.addEventListener("click", () => {
        const card = btn.closest(".card");
        const mk = card?.dataset?.month;
        if (!mk) return;
        const hist = getJSON(KEYS.history, {});
        const rows = (hist[mk] || []).slice();
        try {
          exportExcel(rows, mk);
        } catch (err) {
          console.error("exportExcel:", err);
          alert("Xuất Excel lỗi.");
        }
      });
    });

    // XÓA BẢNG THÁNG
    wrap.querySelectorAll(".btn-del-month").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const card = btn.closest(".card");
        const mk = card?.dataset?.month;
        if (!mk) return;
        if (!confirm(`Xóa toàn bộ bảng tháng ${labelFromMonthKey(mk)}?`)) return;
        const hist = getJSON(KEYS.history, {});
        delete hist[mk];
        setJSON(KEYS.history, hist);
        try {
          recomputePrevDebtFromHistory();
        } catch {}
        if (isInRoom()) {
          try {
            await pushHistoryAll();
          } catch (err) {
            console.warn("pushHistoryAll:", err);
          }
        }
        rememberHistoryUIState(el);
        render();
      });
    });

    // TÌM KIẾM TRONG THÁNG
    wrap.querySelectorAll(".search-month").forEach((inp) => {
      inp.addEventListener("input", (e) => {
        const term = canon(e.target.value);
        const card = inp.closest(".card");
        if (!card) return;
        const rows = card.querySelectorAll("tbody .history-row");
        rows.forEach((r) => {
          const name = canon(r.querySelector("td:nth-child(1)")?.textContent);
          const addr = canon(r.querySelector("td:nth-child(2)")?.textContent);
          const visible = !term || name.includes(term) || addr.includes(term);
          r.style.display = visible ? "" : "none";
        });
      });
    });

    // Helper chuẩn hoá chuỗi tìm kiếm (đã có ở history.js nhưng copy lại hoặc export từ đó nếu cần, 
    // ở đây viết luôn cho gọn vì scope view)
    function deaccent(s) {
      return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
    }
    function canon(s) {
      return deaccent(s).toLowerCase().trim();
    }

    // Enter => Lưu (hiện không có inp-adv/inp-debt, nên không gắn gì)
    wrap.querySelectorAll(".inp-adv, .inp-debt").forEach((inp) => {
      inp.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          const tr = inp.closest("tr");
          tr?.querySelector(".btn-save")?.click();
        }
      });
    });

    // LƯU một dòng: cập nhật paid + tính lại remaining để tháng sau dùng
    wrap.querySelectorAll("tbody").forEach((tbody) => {
      tbody.addEventListener("click", async (e) => {
        const btn = e.target.closest(".btn-save");
        if (!btn) return;
        const tr = btn.closest("tr");
        const mk = btn.closest(".card").dataset.month;
        const idx = Number(tr.dataset.idx);
        const chk = tr.querySelector(".chk-paid");
        const paid = !!chk?.checked;

        const hist = getJSON(KEYS.history, {});
        if (!hist[mk] || !hist[mk][idx]) return;

        // Dùng updateHistoryRow để tự động lan truyền nợ qua các tháng trung gian
        try {
          updateHistoryRow(mk, idx, { paid });
        } catch (err) {
          console.warn("updateHistoryRow:", err);
        }

        if (isInRoom()) {
          try {
            await pushHistoryAll();
          } catch (err) {
            console.warn("pushHistoryAll:", err);
          }
        }

        const savedKey = `${mk}:${idx}`;
        sessionStorage.setItem("history.lastSavedKey", savedKey);
        const until = Date.now() + 1500;
        sessionStorage.setItem("history.lastSavedUntil", String(until));

        rememberHistoryUIState(el);
        render();
      });
    });

    // “Đã lưu” vài giây
    (function applyLastSavedIndicator() {
      const key = sessionStorage.getItem("history.lastSavedKey");
      const until = Number(sessionStorage.getItem("history.lastSavedUntil") || 0);
      if (!key) return;
      const row = wrap.querySelector(`.history-row[data-key="${key}"]`);
      if (!row) return;
      const btn = row.querySelector(".btn-save");
      if (!btn) return;
      btn.textContent = "Đã lưu";
      btn.setAttribute("disabled", "true");
      hidePreview();

      const left = Math.max(0, until - Date.now());
      setTimeout(() => {
        const r2 = wrap.querySelector(`.history-row[data-key="${key}"]`);
        if (r2) {
          const b2 = r2.querySelector(".btn-save");
          if (b2) {
            b2.textContent = "Lưu";
            b2.removeAttribute("disabled");
          }
        }
        sessionStorage.removeItem("history.lastSavedKey");
        sessionStorage.removeItem("history.lastSavedUntil");
      }, Math.min(left || 1200, 3000));
    })();
  }

  el.querySelector("#apply").addEventListener("click", render);

  // ====== Import Excel/CSV ======
  el.querySelector("#btnImport").addEventListener("click", async () => {
    const out = el.querySelector("#impStatus");
    const f = el.querySelector("#impFile").files?.[0];
    const mk = el.querySelector("#impMonth").value; // 'YYYY-MM'
    if (!f) {
      out.textContent = "Chọn tệp .xlsx/.xls/.csv.";
      return;
    }

    try {
      const ext = f.name.split(".").pop().toLowerCase();

      // Chuẩn hoá về dạng rows[] có field .month
      let rows = [];
      if (ext === "xlsx" || ext === "xls") {
        const ret = await parseHistoryXlsx(f, { monthKey: mk || "" });
        if (Array.isArray(ret)) {
          rows = ret;
        } else if (ret && Array.isArray(ret.rows)) {
          rows = ret.rows.map((r) => (mk ? { ...r, month: mk } : r));
          if (!mk && ret.monthKey)
            rows = rows.map((r) => ({ ...r, month: r.month || ret.monthKey }));
        }
      } else {
        const text = await f.text();
        const ret = parseHistoryCsv(text);
        if (Array.isArray(ret)) {
          rows = ret;
        } else if (ret && Array.isArray(ret.rows)) {
          rows = ret.rows;
        }
      }

      // Gán month mặc định nếu người dùng đã nhập ở ô "Tháng đích"
      if (mk) rows = rows.map((r) => ({ ...r, month: r.month || mk }));

      if (!rows.length) {
        out.textContent = "Tệp rỗng hoặc sai định dạng.";
        return;
      }

      const involvedMonths = Array.from(
        new Set(rows.map((r) => r.month || mk))
      ).filter(Boolean);
      if (!involvedMonths.length) {
        out.textContent = "File không có cột tháng. Chọn tháng đích trước khi nhập.";
        return;
      }
      const future = involvedMonths.find((mm) => isFutureMonth(mm));
      if (future) {
        out.textContent = `Không thể nhập tháng tương lai: ${future}`;
        return;
      }

      // Gom theo month và import
      const byMonth = {};
      for (const r of rows) {
        const mm = r.month || mk;
        if (!mm) continue;
        if (!byMonth[mm]) byMonth[mm] = [];
        byMonth[mm].push(r);
      }

      let totalRows = 0;
      for (const [monthKey, arr] of Object.entries(byMonth)) {
        importHistoryMonth(monthKey, arr);
        totalRows += arr.length;
      }
      setStr(KEYS.historyLastImp, new Date().toISOString());

      try {
        recomputePrevDebtFromHistory();
      } catch {}
      if (isInRoom()) {
        try {
          await pushHistoryAll();
        } catch (e) {
          console.warn("pushHistoryAll:", e);
        }
      }

      out.textContent = `Đã nhập ${totalRows} dòng cho ${
        Object.keys(byMonth).length
      } tháng.`;
      rememberHistoryUIState(el);
      render();
    } catch (err) {
      out.textContent = "Lỗi nhập: " + (err.message || err);
    } finally {
      el.querySelector("#impFile").value = "";
    }
  });

  // Render lần đầu
  render();
  enableWebWide(el);
  restoreHistoryUIState(el);

  // === Auto-refresh khi history đổi (do sync từ thiết bị khác) ============
  let lastHash = calcHash(getJSON(KEYS.history, {}) || {});
  (function tick() {
    try {
      const curr = getJSON(KEYS.history, {}) || {};
      const h = calcHash(curr);
      if (h !== lastHash) {
        lastHash = h;
        rememberHistoryUIState(el);
        render();
        const ev = new CustomEvent("history:changed");
        window.dispatchEvent(ev);
      }
    } catch {}
    setTimeout(tick, 700);
  })();
}
