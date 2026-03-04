// src/views/FormView.js
import { addResident, listResidents } from "../state/readings.js";
import { enforceIntegerInput } from "../utils/numeric.js";
import { ZONES, zoneLabel } from "../state/zones.js";
import { isInRoom, pushOneResident } from "../sync/room.js";

function goBackOneStepOrList() {
  if (sessionStorage.getItem("list.ui") && window.history.length > 1) {
    try { history.back(); return; } catch {}
  }
  location.hash = "#/list";
}

export function mount(el) {
  const zoneOptions = ZONES
    .map(z => `<option value="${z.key}" ${z.key === "khac" ? "selected" : ""}>${z.label}</option>`)
    .join("");

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
              <select id="zoneSel" class="input">
                ${zoneOptions}
              </select>
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
    if (!name) { alert("Vui lòng nhập tên."); el.querySelector("#name").focus(); return; }

    const zone = zoneSel.value;
    const address = zone === "khac" ? (addrInp.value || "").trim() : "";
    const startElec = Number(e0.value || 0);
    const startWater = Number(w0.value || 0);

    try {
      addResident({ name, zone, address, startElec, startWater });

      // Realtime: đẩy người mới lên Room (nếu đang ở trong phòng)
      if (isInRoom()) {
        const all = listResidents();
        const newIt = all[all.length - 1];
        try { await pushOneResident(newIt); } catch (e) { console.warn("pushOneResident:", e); }
      }

      goBackOneStepOrList();
    } catch (e) {
      alert("Thêm cư dân thất bại: " + (e?.message || e));
    }
  });

  el.querySelector("#cancelBtn").addEventListener("click", goBackOneStepOrList);
}

export default { mount };
