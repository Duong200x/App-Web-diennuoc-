// src/views/backupview.js
// Màn hình quản lý sao lưu/khôi phục cục bộ (xoay vòng 3 bản).
// Phụ thuộc các API trong backup.js:
//   - saveBackupLocal(maxKeep), listBackupsLocal(), readBackupLocal(key),
//     readLatestBackupLocal(), downloadBackup(), restoreFromJsonText(text)

import {
  saveBackupLocal,
  listBackupsLocal,
  readBackupLocal,
  readLatestBackupLocal,
  downloadBackup,
  restoreFromJsonText,
} from "../state/backup.js";
import { money } from "../utils/format.js";
import { saveTextSmart } from "../utils/save.js";
import { showLoading } from "../ui/busy.js";
import {
  isInRoom,
  getRoomId,
  pushAllToRoom,
  pushHistoryAll,
  pushMonthPtr,
} from "../sync/room.js";

function $(sel, root = document) { return root.querySelector(sel); }

/* ===== Styles (đảm bảo tương phản ở theme sáng) ===== */
function ensureStyles() {
  if (document.getElementById("backupview-style")) return;
  const st = document.createElement("style");
  st.id = "backupview-style";
  st.textContent = `
    .theme-light #backupViewMount,
    .theme-light #backupViewMount *{
      --border: rgba(0,0,0,.15);
      color:#111827;
    }
    .theme-dark #backupViewMount,
    .theme-dark #backupViewMount *{
      --border: rgba(148,163,184,.25);
      color:#e5e7eb;
    }

    .backup-actions{ display:flex; gap:10px; flex-wrap:wrap; align-items:center; }
    .backup-list{ width:100%; border-collapse: collapse; }
    .backup-list th, .backup-list td{ border-top:1px solid var(--border); padding:10px 8px; }
    .backup-list th{ text-align:left; opacity:1; font-weight:700; }
    .theme-light .backup-list tr:hover{ background: rgba(0,0,0,.04); }
    .theme-dark  .backup-list tr:hover{ background: rgba(148,163,184,.08); }
    .backup-list .key{ font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size:12px; opacity:.9; }
    .muted{ opacity:.8; }
    .ok{ color:#065f46; } .warn{ color:#b45309; } .err{ color:#b91c1c; }
    .chip{ display:inline-flex; gap:6px; align-items:center; border:1px solid var(--border);
           border-radius:999px; padding:4px 8px; font-size:12px; }
    .help{ font-size: 13px; opacity:.9; }
    .btn.small{ padding:6px 10px; font-size:13px; }
    @media (max-width: 520px){
      .backup-list th:nth-child(3), .backup-list td:nth-child(3){ display:none; }
    }
  `;
  document.head.appendChild(st);
}

/* ===== Helpers ===== */
function fmtDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const p = (n) => String(n).padStart(2, "0");
    return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
  } catch { return iso; }
}

function countSnapshot(sn) {
  const cur = Array.isArray(sn?.current) ? sn.current.length : 0;
  const months = sn?.history ? Object.keys(sn.history).length : 0;
  let rows = 0;
  if (sn?.history && typeof sn.history === "object") {
    for (const k of Object.keys(sn.history)) rows += Array.isArray(sn.history[k]) ? sn.history[k].length : 0;
  }
  return { cur, months, rows };
}

function calcTotalsOfCurrent(current) {
  try {
    const arr = Array.isArray(current) ? current : [];
    const sum = arr.reduce((acc, it) => {
      const e = Number(it.__elec || 0);
      const w = Number(it.__water || 0);
      const t = Number(it.__total || (e + w + Number(it.prevDebt || 0)));
      acc.e += e; acc.w += w; acc.t += t; return acc;
    }, { e:0, w:0, t:0 });
    return `Điện: ${money(sum.e)} • Nước: ${money(sum.w)} • Tổng: ${money(sum.t)}`;
  } catch { return ""; }
}

/* ===== View ===== */
export function mount(el) {
  ensureStyles();

  el.innerHTML = `
    <div class="container" id="backupViewMount">
      <div class="card">
        <div class="toolbar" style="justify-content:space-between">
          <h2>Sao lưu & Khôi phục</h2>
          <div class="backup-actions">
            <button class="btn" id="btnBackupNow">Tạo bản sao lưu mới</button>
            <button class="btn ghost" id="btnDownloadLatest">Tải JSON bản mới nhất</button>
            <label class="btn ghost">
              Nhập từ tệp JSON
              <input id="fileJson" type="file" accept=".json" style="display:none">
            </label>
          </div>
        </div>

        <p class="help">Hệ thống tự động xoay vòng <b>tối đa 3 bản</b> sao lưu cục bộ. Bạn có thể khôi phục về bất kỳ bản nào trong danh sách dưới.</p>

        <div class="table-wrap">
          <table class="backup-list">
            <thead>
              <tr>
                <th style="width:36%">Thời điểm</th>
                <th style="width:30%">Thống kê</th>
                <th>Key</th>
                <th style="text-align:right">Hành động</th>
              </tr>
            </thead>
            <tbody id="bkBody"></tbody>
          </table>
        </div>

        <div class="spacer"></div>
        <div id="preview" class="muted"></div>
      </div>
    </div>
  `;

  const body = $("#bkBody", el);
  const preview = $("#preview", el);

  function renderList() {
    const keys = listBackupsLocal(); // mới → cũ
    const inRoom = isInRoom();
    if (!keys.length) {
      body.innerHTML = `<tr><td colspan="4" class="center muted" style="padding:18px">Chưa có bản sao lưu nào.</td></tr>`;
      preview.textContent = "";
      return;
    }
    body.innerHTML = keys.map((k, idx) => {
      const snap = readBackupLocal(k);
      const meta = countSnapshot(snap || {});
      const label = snap?.createdAt ? fmtDate(snap.createdAt) : "(không rõ)";
      const tag = idx === 0 ? `<span class="chip">Mới nhất</span>` : "";
      return `
        <tr data-key="${k}">
          <td>${label} ${tag}</td>
          <td>
            <div>Hiện tại: <b>${meta.cur}</b> cư dân</div>
            <div>Lịch sử: <b>${meta.months}</b> tháng, <b>${meta.rows}</b> dòng</div>
          </td>
          <td class="key">${k}</td>
          <td style="text-align:right; white-space:nowrap;">
            <button class="btn small ghost act-preview">Xem</button>
            <button class="btn small ghost act-download">Tải</button>
            <button class="btn small danger act-restore">Khôi phục</button>
            ${inRoom ? `<button class="btn small act-restore-sync">Khôi phục + ĐB</button>` : ""}
          </td>
        </tr>
      `;
    }).join("");
  }

  function bindListActions() {
    body.querySelectorAll("tr[data-key]").forEach((tr) => {
      const key = tr.getAttribute("data-key");

      // Xem
      tr.querySelector(".act-preview").addEventListener("click", () => {
        const sn = readBackupLocal(key);
        if (!sn) { preview.innerHTML = `<div class="err">Không đọc được dữ liệu.</div>`; return; }
        const meta = countSnapshot(sn);
        const totals = calcTotalsOfCurrent(sn.current);
        preview.innerHTML = `
          <div class="card" style="margin-top:8px;">
            <div class="toolbar" style="justify-content:space-between">
              <h3>Chi tiết bản sao lưu • <span class="muted">${fmtDate(sn.createdAt || "")}</span></h3>
              <span class="chip">Tháng hiện tại: <b>${sn.month || "-"}</b></span>
            </div>
            <div style="display:flex; gap:14px; flex-wrap:wrap;">
              <div>• Cư dân hiện tại: <b>${meta.cur}</b></div>
              <div>• Lịch sử: <b>${meta.months}</b> tháng / <b>${meta.rows}</b> dòng</div>
              <div>• Tỷ giá: Điện <b>${sn.electricityRate}</b> • Nước <b>${sn.waterRate}</b></div>
            </div>
            <div class="spacer"></div>
            <div class="help">${totals}</div>
          </div>
        `;
        preview.scrollIntoView({ block: "center", behavior: "smooth" });
      });

      // Tải đúng bản chọn
      tr.querySelector(".act-download").addEventListener("click", async () => {
        try {
          const ok = confirm("Tải đúng bản sao lưu đã chọn?");
          if (!ok) return;
          const sn = readBackupLocal(key);
          if (!sn) throw new Error("Không đọc được bản sao lưu.");
          const text = JSON.stringify(sn, null, 2);
          const safeKey = String(key).replace(/[^\w\-:.]/g, "_");
          const name = `backup_${safeKey}.json`;
          await saveTextSmart(text, "application/json", name);
        } catch (e) {
          alert("Không thể tải: " + (e?.message || e));
        }
      });

      // Khôi phục / Khôi phục + Đồng bộ
      const doRestore = async ({ syncToRoom }) => {
        const msg = syncToRoom
          ? "Khôi phục sẽ ghi đè dữ liệu hiện tại bằng dữ liệu trong bản sao lưu này và ĐẨY lên phòng (các máy khác sẽ tự cập nhật). Tiếp tục?"
          : "Khôi phục sẽ ghi đè dữ liệu hiện tại bằng dữ liệu trong bản sao lưu này. Tiếp tục?";
        if (!confirm(msg)) return;

        const loading = showLoading(syncToRoom ? "Đang khôi phục & đồng bộ..." : "Đang khôi phục...");
        try {
          const sn = readBackupLocal(key);
          if (!sn) throw new Error("Không đọc được bản sao lưu.");

          // 1) Khôi phục local trước (offline vẫn làm được)
          await restoreFromJsonText(JSON.stringify(sn));

          // 2) Nếu chọn sync: đẩy snapshot lên phòng
          if (syncToRoom) {
            const rid = getRoomId();
            if (!rid) throw new Error("Chưa vào phòng. Hãy vào mục Phòng để tạo/nhập mã phòng trước.");
            if (typeof navigator !== "undefined" && navigator.onLine === false) {
              throw new Error("Đang offline. Hãy bật mạng rồi thử đồng bộ lại.");
            }

            await pushAllToRoom(rid);
            await pushHistoryAll(rid);
            await pushMonthPtr(rid);
          }

          alert(syncToRoom
            ? "Đã khôi phục và đồng bộ lên phòng. Các máy khác sẽ tự cập nhật nếu đang mở ứng dụng."
            : "Đã khôi phục dữ liệu từ bản sao lưu."
          );
          if (typeof window !== "undefined") window.location.reload();
        } catch (e) {
          alert((syncToRoom ? "Khôi phục/đồng bộ thất bại: " : "Khôi phục thất bại: ") + (e?.message || e));
        } finally {
          try { loading?.hide?.(); } catch {}
        }
      };

      tr.querySelector(".act-restore").addEventListener("click", () => doRestore({ syncToRoom: false }));

      const btnSync = tr.querySelector(".act-restore-sync");
      if (btnSync) btnSync.addEventListener("click", () => doRestore({ syncToRoom: true }));
    });
  }

  // Toolbar
  $("#btnBackupNow", el).addEventListener("click", () => {
    const r = saveBackupLocal(3); // ép giữ 3 bản
    if (r && r.key) alert(`Đã tạo bản sao lưu: ${r.key}`);
    renderList(); bindListActions();
  });

  $("#btnDownloadLatest", el).addEventListener("click", async () => {
    try {
      const latest = readLatestBackupLocal();
      if (!latest) {
        if (confirm("Chưa có bản sao lưu cục bộ. Tạo ngay bây giờ?")) {
          const r = saveBackupLocal(3);
          if (!r) return;
          renderList(); bindListActions();
        } else return;
      }
      await downloadBackup(); // tải snapshot hiện tại
    } catch (e) {
      alert("Không thể tải: " + (e?.message || e));
    }
  });

  // Import JSON
  $("#fileJson", el).addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      await restoreFromJsonText(text);
      alert("Đã khôi phục dữ liệu từ tệp JSON.");
      window.location.reload();
    } catch (e) {
      alert("Tệp không hợp lệ: " + (e?.message || e));
    } finally {
      ev.target.value = "";
    }
  });

  // Render đầu tiên
  renderList(); bindListActions();

  // Preview nhẹ bản mới nhất
  const latest = readLatestBackupLocal();
  if (latest) {
    const meta = countSnapshot(latest);
    preview.innerHTML = `
      <div class="help" style="margin-top:8px">
        Bản mới nhất: <b>${fmtDate(latest.createdAt || "")}</b> —
        hiện tại <b>${meta.cur}</b> cư dân, lịch sử <b>${meta.months}</b> tháng / <b>${meta.rows}</b> dòng.
      </div>
    `;
  }

  /* ===== Auto-refresh khi backup thay đổi ở nơi khác ===== */
  let lastSig = "";
  const makeSig = () => {
    const keys = listBackupsLocal();
    const l = readLatestBackupLocal();
    return JSON.stringify([keys, l?.createdAt || null]);
  };
  const refreshIfChanged = () => {
    const s = makeSig();
    if (s !== lastSig) { lastSig = s; renderList(); bindListActions(); }
  };

  window.addEventListener("backup:index-changed", refreshIfChanged); // phát từ backup.js
  window.addEventListener("storage", (e) => {
    if (!e.key) return;
    if (e.key === "BACKUP_INDEX" || e.key === "BACKUP_LATEST" || e.key.startsWith("BACKUP_HISTORY_")) {
      refreshIfChanged();
    }
  });
  setInterval(refreshIfChanged, 800);
}
