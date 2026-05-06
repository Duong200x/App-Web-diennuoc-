// src/views/ConfigView.js
import { getRates, setRates } from "../state/rates.js";
import { initFirebase, getDb, clearAuthSession } from "../sync/firebase.js";
import { showToast } from "../ui/toast.js";
import {
  downloadBackup,
  restoreFromJsonText,
  clearAllData,
  saveBackupLocal,
  readLatestBackupLocal,
  listBackupsLocal,
  makeSnapshot,
} from "../state/backup.js";
import { enforceIntegerInput } from "../utils/numeric.js";
import { saveTextSmart } from "../utils/save.js";

export function mount(el) {
  const { electricityRate, waterRate } = getRates();

  el.innerHTML = `
    <div class="container">
      <div class="card">
        <h2>Điều chỉnh giá</h2>
        <form id="cfg">
          <div class="form-grid">
            <label class="label">Giá điện (VND/kWh)
              <input class="input" type="number" id="e" value="${electricityRate}" min="0"/>
            </label>
            <label class="label">Giá nước (VND/m³)
              <input class="input" type="number" id="w" value="${waterRate}" min="0"/>
            </label>
          </div>
          <div class="toolbar" style="justify-content:flex-end;margin-top:12px;">
            <button class="btn">Lưu</button>
          </div>
        </form>
      </div>

      <div class="spacer"></div>

      <div class="card">
        <h2>Sao lưu & Phục hồi</h2>
        <div class="toolbar" style="flex-wrap:wrap; gap:8px;">
          <button class="btn" id="backupBtn">Tải bản sao lưu (.json)</button>

          <input type="file" id="restoreFile" accept="application/json" style="display:none">
          <button class="btn ghost" id="restoreBtn">Phục hồi từ tệp</button>

          <!-- đổi về giữ 3 bản -->
          <button class="btn secondary" id="bkLocalBtn">Sao lưu cục bộ (giữ 3 bản)</button>
          <button class="btn ghost" id="quickRestoreBtn">Khôi phục nhanh (bản mới nhất)</button>
          <a class="btn ghost" href="#/backups" id="viewListBtn">Xem danh sách bản sao lưu</a>
        </div>
        <p class="helper">
          • “Tải bản sao lưu” tạo tệp .json để bạn lưu ngoài máy.<br/>
          • “Sao lưu cục bộ” lưu trực tiếp trong trình duyệt/ứng dụng, tự động xoay vòng <b>3 bản</b> gần nhất.<br/>
          • Bạn có thể mở mục “Xem danh sách bản sao lưu” để phục hồi bất kỳ bản nào.
        </p>
        <div id="bkListHint" class="helper" style="opacity:.9"></div>
      </div>

      <div class="spacer"></div>

      <div class="card">
        <h2>Dữ liệu</h2>
        <div class="toolbar">
          <button class="btn danger" id="clearBtn">Xóa tất cả dữ liệu</button>
        </div>
        <p class="helper">Thao tác này xóa toàn bộ cư dân, lịch sử, cấu hình. Không thể hoàn tác.</p>
      </div>
    </div>
  `;

  enforceIntegerInput(el.querySelector("#e"));
  enforceIntegerInput(el.querySelector("#w"));

  // Lưu đơn giá
  el.querySelector("#cfg").addEventListener("submit", (e) => {
    e.preventDefault();
    setRates(
      Number(el.querySelector("#e").value),
      Number(el.querySelector("#w").value)
    );
    showToast("Đã lưu giá.", "success");
  });

  // Sao lưu ra file .json (tải xuống / share)
  el.querySelector("#backupBtn").addEventListener("click", () => downloadBackup());

  // Sao lưu cục bộ (xoay vòng 3 bản)
  const bkLocalBtn = el.querySelector("#bkLocalBtn");
  bkLocalBtn.addEventListener("click", () => {
    try {
      const { key } = saveBackupLocal(3); // ⬅ chỉ giữ 3 bản
      showToast("Đã sao lưu cục bộ: " + key, "success");
      renderLocalListHint();
    } catch (e) {
      showToast("Không thể sao lưu cục bộ: " + (e?.message || e), "error");
    }
  });

  // Gợi ý quick list (đếm số bản đang có)
  function renderLocalListHint() {
    const wrap = el.querySelector("#bkListHint");
    try {
      const arr = listBackupsLocal();
      if (!arr || !arr.length) {
        wrap.textContent = "Chưa có bản sao lưu cục bộ nào.";
      } else {
        wrap.textContent = `Hiện có ${arr.length} bản sao lưu cục bộ (mới → cũ). Nhấn “Xem danh sách bản sao lưu” để quản lý.`;
      }
    } catch {
      wrap.textContent = "";
    }
  }
  renderLocalListHint();

  // Phục hồi từ file .json
  const fileInput = el.querySelector("#restoreFile");
  el.querySelector("#restoreBtn").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      await restoreFromJsonText(text);
      showToast("Phục hồi thành công. Ứng dụng sẽ tải lại.", "success");
      location.hash = "#/list";
      setTimeout(() => window.location.reload(), 1500);
    } catch (err) {
      showToast("Lỗi phục hồi: " + (err.message || err), "error");
    } finally {
      fileInput.value = "";
    }
  });

  // Khôi phục nhanh từ bản cục bộ mới nhất
  const quickBtn = el.querySelector("#quickRestoreBtn");
  quickBtn.addEventListener("click", async () => {
    try {
      const snap = readLatestBackupLocal();
      if (!snap) { showToast("Không tìm thấy bản sao lưu cục bộ mới nhất.", "error"); return; }
      await restoreFromJsonText(JSON.stringify(snap));
      showToast("Đã phục hồi từ bản sao lưu cục bộ mới nhất. Ứng dụng sẽ tải lại.", "success");
      location.hash = "#/list";
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) {
      showToast("Khôi phục nhanh thất bại: " + (e?.message || e), "error");
    }
  });

  // Xóa dữ liệu
  el.querySelector("#clearBtn").addEventListener("click", async () => {
    if (confirm("Xóa toàn bộ dữ liệu ứng dụng? (không thể hoàn tác)")) {
      const shouldBackup = confirm("Bạn có muốn sao lưu vào file trước khi xóa không?");
      if (shouldBackup) {
        try {
          const snap = makeSnapshot();
          const d = new Date();
          const p = (n) => String(n).padStart(2, "0");
          const filename = `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}_diennuoc.json`;
          await saveTextSmart(JSON.stringify(snap, null, 2), "application/json", filename);
        } catch (e) {
          showToast("Không thể sao lưu trước khi xóa: " + (e?.message || e), "error");
          return;
        }
      }
      try { await clearAuthSession(); } catch {}
      clearAllData();
      showToast("Đã xóa. Ứng dụng sẽ tải lại.", "success");
      location.hash = "#/list";
      setTimeout(() => window.location.reload(), 1000);
    }
  });
}

export default { mount };
