// src/view/manageview.js
// Quản lý cư dân (theo index): sửa chỉ số, zone/địa chỉ, nợ/tạm ứng, đánh dấu đã đóng.
// Nâng cấp: preview số tiền theo thời gian thực, giữ focus/scroll sau khi lưu,
// đồng bộ realtime (Room), xóa có phát tombstone.

import {
  listResidents,
  updateFullAdmin,
  removeResident,
  computeAmounts,
  renameResidentInHistory,
} from "../state/readings.js";
import { enforceIntegerInput } from "../utils/numeric.js";
import { ZONES, zoneLabel } from "../state/zones.js";
import { isInRoom, pushOneResident, pushDeleteResident } from "../sync/room.js";
import { ensureAuth } from "../sync/firebase.js";
import { showLoading } from "../ui/busy.js";
import { showToast } from "../ui/toast.js";
import { money } from "../utils/format.js";
import { residentIdentity, residentKey } from "../utils/normalize.js";
import { escapeHTML as esc } from "../utils/html.js";
import { optionButtons, setupCustomSelect } from "../ui/customSelect.js";

/* Lùi 1 bước nếu có trạng thái list, fallback về #/list */
function goBackOneStepOrList() {
  if (sessionStorage.getItem("list.ui") && window.history.length > 1) {
    try { history.back(); return; } catch {}
  }
  location.hash = "#/list";
}

/* Nhớ focus + selection + scroll để không "nhảy" sau render */
function rememberUIState(root) {
  try {
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : "";
    const selStart = active && "selectionStart" in active ? active.selectionStart : null;
    const selEnd   = active && "selectionEnd" in active ? active.selectionEnd : null;
    const scrollY  = window.scrollY || document.documentElement.scrollTop || 0;
    root.__uiMem = { focusId, selStart, selEnd, scrollY };
  } catch {}
}
function restoreUIState(root) {
  try {
    const m = root.__uiMem;
    if (!m) return;
    if (Number.isFinite(m.scrollY)) window.scrollTo(0, m.scrollY);
    if (m.focusId) {
      const el = root.querySelector("#" + m.focusId);
      if (el) {
        el.focus();
        if (m.selStart != null && m.selEnd != null && el.setSelectionRange) {
          el.setSelectionRange(m.selStart, m.selEnd);
        }
      }
    }
  } catch {}
}

/* Tạo HTML option cho Zone */
function buildZoneOptions(it) {
  return optionButtons(ZONES.map((o) => ({ value: o.key, label: o.label })));
}

/* Sync trạng thái ô địa chỉ theo zone */
function syncAddrLock(zoneSel, addrInp) {
  if (zoneSel.value === "khac") {
    addrInp.disabled = false;
    addrInp.placeholder = "Nhập địa chỉ (không bắt buộc)";
  } else {
    addrInp.value = "";
    addrInp.disabled = true;
    addrInp.placeholder = `Đã chọn ${zoneLabel(zoneSel.value)} (khóa)`;
  }
}

/* Tính & hiển thị preview số tiền */
function refreshPreview(root, snapshot) {
  const toNum = (v) => Number(v || 0);
  const tmp = {
    ...snapshot,
    newElec: toNum(root.querySelector("#newElec").value),
    newWater: toNum(root.querySelector("#newWater").value),
    prevDebt: Math.max(0, toNum(root.querySelector("#prevDebt").value)),
    advance:  Math.max(0, toNum(root.querySelector("#advance").value)),
    paid:     root.querySelector("#paidChk").checked,
  };

  // Nếu chọn "Đã đóng", preview advance = total
  let s = computeAmounts(tmp);
  if (tmp.paid) {
    tmp.advance = s.total;
    s = computeAmounts(tmp);
  }

  root.querySelector("#pvElec").textContent   = money(s.elecMoney || 0);
  root.querySelector("#pvWater").textContent  = money(s.waterMoney || 0);
  root.querySelector("#pvDebt").textContent   = money(Number(s.prevDebt || 0));
  root.querySelector("#pvAdv").textContent    = money(Number(tmp.advance || 0));
  root.querySelector("#pvRemain").textContent = money(Number(s.total - (tmp.advance || 0)));
  root.querySelector("#pvTotal").textContent  = money(s.total || 0);
}

export function mount(el, idx) {
  const all = listResidents();
  const idxByNumber = Number(idx);
  const resolvedIdx = Number.isInteger(idxByNumber)
    ? idxByNumber
    : all.findIndex((r) => residentIdentity(r) === String(idx || "") || residentKey(r) === String(idx || ""));
  const it = all[resolvedIdx];
  if (!it) {
    el.innerHTML = `<div class="container"><div class="card"><h2>Không tìm thấy cư dân</h2></div></div>`;
    return;
  }
  const initialKey = residentIdentity(it);
  const getTargetIndex = () => {
    const rows = listResidents();
    const byKey = rows.findIndex((r) => residentIdentity(r) === initialKey || residentKey(r) === initialKey);
    return byKey >= 0 ? byKey : resolvedIdx;
  };

  const zonesHtml = buildZoneOptions(it);

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <h2>Quản lý cư dân</h2>
          <div class="toolbar">
            <a class="btn ghost" href="#/detail/${encodeURIComponent(residentIdentity(it))}">Chi tiết</a>
            <a class="btn" href="#/list">Danh sách</a>
          </div>
        </div>

        <form id="manage">
          <div class="form-grid">
            <label class="label">Tên
              <input class="input" id="name" value="${esc(it.name)}">
            </label>

            <label class="label">Khu
              <div class="custom-select" data-target="zoneSel">
                <input type="hidden" id="zoneSel" value="${esc(it.zone || "khac")}">
                <button type="button" class="custom-select-btn" data-value="${esc(it.zone || "khac")}">${zoneLabel(it.zone || "khac")}</button>
                <div class="custom-select-menu" hidden>${zonesHtml}</div>
              </div>
            </label>

            <label class="label">Địa chỉ (chỉ nhập khi chọn Khác)
              <input class="input" id="addrInp" value="${esc(it.address || "")}" placeholder="Nhập địa chỉ (không bắt buộc)">
            </label>

            <label class="label">Điện cũ (kWh)
              <input class="input" id="oldElec" type="text" inputmode="numeric" pattern="[0-9]*" value="${it.oldElec}">
            </label>

            <label class="label">Nước cũ (m³)
              <input class="input" id="oldWater" type="text" inputmode="numeric" pattern="[0-9]*" value="${it.oldWater}">
            </label>

            <label class="label">Điện mới (kWh)
              <input class="input" id="newElec" type="text" inputmode="numeric" pattern="[0-9]*" value="${it.newElec}">
            </label>

            <label class="label">Nước mới (m³)
              <input class="input" id="newWater" type="text" inputmode="numeric" pattern="[0-9]*" value="${it.newWater}">
            </label>

            <label class="label">Nợ cũ (đ)
              <input class="input" id="prevDebt" type="text" inputmode="numeric" pattern="[0-9]*" value="${Number(it.prevDebt || 0)}" placeholder="0">
              <div class="helper">Giá trị này sẽ in vào biên lai (và cộng vào tổng).</div>
            </label>

            <label class="label">Tạm ứng (đã thu)
              <input class="input" id="advance" type="text" inputmode="numeric" pattern="[0-9]*" value="${Number(it.advance || 0)}" placeholder="0">
              <div class="helper">Sửa số tiền đã thu của kỳ hiện tại. Nếu bật “Đã đóng”, hệ thống sẽ tự đặt bằng Tổng.</div>
            </label>

            <label class="label">Trạng thái thanh toán
              <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
                <input type="checkbox" id="paidChk" ${it.paid ? "checked" : ""}> <span>Đã đóng</span>
              </div>
              <div class="helper">Bật “Đã đóng” ⇒ tạm ứng = tổng tiền hiện tại (bao gồm nợ cũ).</div>
            </label>
          </div>

          <div class="spacer"></div>

          <!-- Preview số tiền -->
          <div class="card" style="border:1px solid var(--border); border-radius:12px;">
            <div class="toolbar"><h3>Tổng hợp</h3></div>
            <div class="grid" style="display:grid;grid-template-columns: 1fr 1fr; gap:10px">
              <div>Tiền điện</div><div style="text-align:right"><b id="pvElec">0</b></div>
              <div>Tiền nước</div><div style="text-align:right"><b id="pvWater">0</b></div>
              <div>Nợ cũ</div><div style="text-align:right"><b id="pvDebt">0</b></div>
              <div>Đã thu</div><div style="text-align:right"><b id="pvAdv">0</b></div>
              <div>Còn thiếu</div><div style="text-align:right"><b id="pvRemain">0</b></div>
              <div><b>TỔNG</b></div><div style="text-align:right"><b id="pvTotal">0</b></div>
            </div>
          </div>

          <div class="spacer"></div>
          <div class="toolbar" style="justify-content:flex-end; gap:8px;">
            <button type="button" class="btn secondary" id="del">Xóa cư dân</button>
            <button class="btn" id="btnSave">Lưu thay đổi</button>
            <button type="button" class="btn ghost" id="back">Quay lại</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Khóa/mở ô địa chỉ theo zone
  const zoneSel = el.querySelector("#zoneSel");
  const addrInp = el.querySelector("#addrInp");
  setupCustomSelect(el, "zoneSel");
  syncAddrLock(zoneSel, addrInp);
  zoneSel.addEventListener("change", () => syncAddrLock(zoneSel, addrInp));

  // Chỉ cho nhập số nguyên
  ["oldElec","oldWater","newElec","newWater","prevDebt","advance"].forEach(id => {
    enforceIntegerInput(el.querySelector("#" + id));
  });

  // Preview ban đầu + khi gõ
  refreshPreview(el, it);
  ["newElec","newWater","prevDebt","advance","paidChk"].forEach(id => {
    el.querySelector("#" + id).addEventListener("input", () => refreshPreview(el, it));
    el.querySelector("#" + id).addEventListener("change", () => refreshPreview(el, it));
  });

  // Phím tắt
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && ["newElec","newWater","prevDebt","advance","name","addrInp"].includes(e.target.id)) {
      e.preventDefault();
      el.querySelector("#btnSave").click();
    } else if (e.key === "Escape") {
      e.preventDefault();
      goBackOneStepOrList();
    }
  });

  // Lưu
  const form = el.querySelector("#manage");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (isInRoom()) {
      try { await ensureAuth(); } catch (err) {
        showToast("Cần đăng nhập để đồng bộ trực tuyến.", "error");
        return;
      }
    }

    const hide = showLoading("Đang lưu...");
    rememberUIState(el);

    try {
      const name     = el.querySelector("#name").value.trim();
      const zone     = zoneSel.value;
      const address  = zone === "khac" ? (addrInp.value || "").trim() : "";

      const oldElec  = Number(el.querySelector("#oldElec").value || 0);
      const oldWater = Number(el.querySelector("#oldWater").value || 0);
      const newElec  = Number(el.querySelector("#newElec").value || 0);
      const newWater = Number(el.querySelector("#newWater").value || 0);

      const prevDebt = Math.max(0, Number(el.querySelector("#prevDebt").value || 0));
      let   advance  = Math.max(0, Number(el.querySelector("#advance").value || 0));
      const paid     = !!el.querySelector("#paidChk").checked;

      // Tính total theo input hiện tại để áp dụng quy tắc paid/advance
      const tmp = { ...it, name, zone, address, oldElec, oldWater, newElec, newWater, prevDebt, advance };
      const s   = computeAmounts(tmp);
      if (paid) {
        advance = s.total; // đã đóng ⇒ thu đủ
      } else {
        // không tự sửa advance trừ khi người dùng đã nhập, clamp ≥0
        advance = Math.max(0, advance);
      }

      const targetIdx = getTargetIndex();
      const currentOldIt = listResidents()[targetIdx];

      await updateFullAdmin(targetIdx, {
        name, zone, address,
        oldElec, oldWater, newElec, newWater,
        prevDebt, advance, paid,
      });

      try {
        const freshAfterSave = listResidents()[targetIdx];
        renameResidentInHistory(currentOldIt, freshAfterSave);
      } catch (e) {
        console.warn("renameResidentInHistory:", e);
      }

      if (isInRoom()) {
        const fresh = listResidents()[targetIdx];
        try { 
          await pushOneResident(fresh); 
          showToast("Đã cập nhật và đồng bộ.", "success");
        } catch (err) { 
          showToast("Lỗi đồng bộ mới: " + (err?.message || err), "error");
          console.warn("pushOneResident:", err); 
        }
      } else {
        showToast("Đã lưu thay đổi cục bộ.", "success");
      }
      // Ở lại trang để tiếp tục chỉnh: render lại và khôi phục focus
      // Nếu bạn muốn quay về danh sách, thay bằng: goBackOneStepOrList();
      refreshPreview(el, listResidents()[targetIdx]);
      restoreUIState(el);
    } catch (err) {
      showToast(err?.message || err, "error");
    } finally {
      hide();
    }
  });

  // XÓA & phát tombstone lên room
  const btnDel = el.querySelector("#del");
  let deleting = false;
  btnDel.addEventListener("click", async () => {
    if (deleting) return;
    if (!confirm("Xóa cư dân này?")) return;

    if (isInRoom()) {
      try { await ensureAuth(); } catch (err) {
        showToast("Cần đăng nhập để thực hiện xoá trực tuyến.", "error");
        return;
      }
    }

    deleting = true;
    btnDel.disabled = true;
    const hide = showLoading("Đang xóa...");

    try {
      const targetIdx = getTargetIndex();
      const residentBeforeDelete = listResidents()[targetIdx]; // lấy bản mới nhất trước khi xoá
      const removed = removeResident(targetIdx);
      if (!removed) throw new Error("Không xóa được bản ghi.");

      if (isInRoom()) {
        await pushDeleteResident(residentBeforeDelete);
      }

      showToast("Đã xóa cư dân.", "success");
      goBackOneStepOrList();
    } catch (e) {
      showToast("Xóa thất bại: " + (e?.message || e), "error");
      btnDel.disabled = false;
      deleting = false;
    } finally {
      hide();
    }
  });

  el.querySelector("#back").addEventListener("click", goBackOneStepOrList);
}

export default { mount };
