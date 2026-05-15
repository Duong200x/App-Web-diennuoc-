// src/views/FormView.js
import { addResident, listResidents } from "../state/readings.js";
import { enforceIntegerInput } from "../utils/numeric.js";
import { showToast } from "../ui/toast.js";
import { ZONES, zoneLabel } from "../state/zones.js";
import { isInRoom, pushOneResident } from "../sync/room.js";
import { ensureAuth } from "../sync/firebase.js";
import { optionButtons, setupCustomSelect } from "../ui/customSelect.js";

function goBackOneStepOrList() {
  if (sessionStorage.getItem("list.ui") && window.history.length > 1) {
    try { history.back(); return; } catch {}
  }
  location.hash = "#/list";
}

export function mount(el) {
  const zoneOptions = ZONES
    .map((z) => ({ value: z.key, label: z.label }));

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <h2>Thêm cư dân</h2>

        <form id="addForm">
          <div class="form-grid">
            <label class="label">Tên <span class="helper">(bắt buộc)</span>
              <input class="input" type="text" id="name" required placeholder="VD: Nhà Bà Hồng" />
            </label>

            <label class="label">Khu vực
              <div class="custom-select" data-target="zoneSel">
                <input type="hidden" id="zoneSel" value="khac">
                <button type="button" class="custom-select-btn" data-value="khac">${zoneLabel("khac")}</button>
                <div class="custom-select-menu" hidden>${optionButtons(zoneOptions)}</div>
              </div>
            </label>

            <label class="label">Địa chỉ (chỉ nhập khi chọn Khác)
              <input class="input" id="addrInp" placeholder="Nhập địa chỉ (không bắt buộc)">
            </label>

            <label class="label">Chỉ số ban đầu điện (kWh)
              <input class="input" id="startElec" type="text" inputmode="numeric" pattern="[0-9]*" value="0" />
            </label>

            <label class="label">Chỉ số ban đầu nước (m³)
              <input class="input" id="startWater" type="text" inputmode="numeric" pattern="[0-9]*" value="0" />
            </label>
          </div>

          <div class="spacer"></div>
          <div class="toolbar" style="justify-content:flex-end; gap:8px">
            <button type="button" class="btn ghost" id="cancelBtn">Hủy</button>
            <button class="btn">Thêm cư dân</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Khóa/mở ô địa chỉ theo zone
  const zoneSel = el.querySelector("#zoneSel");
  const addrInp = el.querySelector("#addrInp");
  setupCustomSelect(el, "zoneSel");
  const syncAddr = () => {
    if (zoneSel.value === "khac") {
      addrInp.disabled = false;
      addrInp.placeholder = "Nhập địa chỉ (không bắt buộc)";
    } else {
      addrInp.value = "";
      addrInp.disabled = true;
      addrInp.placeholder = `Đã chọn ${zoneLabel(zoneSel.value)} (khóa)`;
    }
  };
  zoneSel.addEventListener("change", syncAddr);
  syncAddr();

  // Chặn nhập ký tự lạ
  const e0 = el.querySelector("#startElec");
  const w0 = el.querySelector("#startWater");
  enforceIntegerInput(e0);
  enforceIntegerInput(w0);

  // Submit
  const form = el.querySelector("#addForm");
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = el.querySelector("#name").value.trim();
    if (!name) { showToast("Vui lòng nhập tên.", "error"); el.querySelector("#name").focus(); return; }

    const zone = zoneSel.value;
    const address = zone === "khac" ? (addrInp.value || "").trim() : "";
    const startElec = Number(e0.value || 0);
    const startWater = Number(w0.value || 0);

    if (isInRoom()) {
      try { await ensureAuth(); } catch (err) {
        showToast("Cần đăng nhập để đồng bộ trực tuyến.", "error"); return;
      }
    }

    try {
      addResident({ name, zone, address, startElec, startWater });

      // Realtime: đẩy người mới lên Room (nếu đang ở trong phòng)
      if (isInRoom()) {
        const all = listResidents();
        const newIt = all[all.length - 1];
        try { await pushOneResident(newIt); } catch (e) {
             showToast("Lỗi đồng bộ: " + (e?.message || e), "error");
             console.warn("pushOneResident:", e);
        }
      }

      goBackOneStepOrList();
    } catch (e) {
      showToast("Thêm cư dân thất bại: " + (e?.message || e), "error");
    }
  });

  el.querySelector("#cancelBtn").addEventListener("click", goBackOneStepOrList);
}

export default { mount };
