import {
  createRoom,
  enterRoom,
  joinRoom,
  leaveRoom,
  getRoomId,
  pullRoomToLocal,
  pushAllToRoom,
  pushHistoryAll,
  pushMonthPtr,
  pushPendingRoomChanges,
} from "../sync/room.js";
import { showLoading } from "../ui/busy.js";
import { showToast } from "../ui/toast.js";
import { downloadBackup } from "../state/backup.js";

function throttle(fn, ms = 300) {
  let t = 0;
  let timer = null;
  return (...args) => {
    const now = Date.now();
    const wait = ms - (now - t);
    if (wait <= 0) {
      t = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => {
        t = Date.now();
        fn(...args);
      }, wait);
    }
  };
}

function ensureRoomCss() {
  if (document.getElementById("room-anti-jitter")) return;
  const st = document.createElement("style");
  st.id = "room-anti-jitter";
  st.textContent = `
    .room-page .btn { transition: none !important; transform: none !important; }
    .room-page .btn[aria-busy="true"] { pointer-events: none; opacity: .7; }
  `;
  document.head.appendChild(st);
}

export function mount(el) {
  ensureRoomCss();

  const rid = getRoomId();

  el.innerHTML = `
    <div class="container room-page">
      <div class="card">
        <h2>Phòng dùng chung</h2>
        <p class="helper">Người tạo nhận mã Phòng (Room ID). Người khác nhập mã đó để cùng sửa một bảng.</p>

        <div class="form-grid">
          <div>
            <div class="toolbar" style="gap:8px;justify-content:flex-start;">
              <button class="btn" id="btnCreate">Tạo phòng mới</button>
            </div>
            <div id="createOut" class="helper"></div>
          </div>

          <div>
            <label class="label">Nhập mã phòng để tham gia</label>
            <input class="input" id="joinCode" placeholder="VD: 4GQ9ZK" style="text-transform:uppercase" />
            <div class="toolbar" style="margin-top:8px;justify-content:flex-end;">
              <button class="btn" id="btnJoin">Tham gia</button>
              <button class="btn ghost" id="btnLeave">Rời phòng</button>
            </div>
            <div id="joinOut" class="helper"></div>
          </div>
        </div>

        <div class="spacer"></div>
        <div class="card">
          <h3 style="margin:0 0 6px;">Trạng thái</h3>
          <p>Room ID hiện tại: <b id="statusRid">${rid || "(chưa tham gia)"}</b></p>
          <p>Trạng thái đồng bộ: <b id="syncStatus">Local</b></p>
          <div class="toolbar" style="justify-content:flex-end;">
            <button class="btn ghost" id="btnSync" ${rid ? "" : "disabled"}>Đồng bộ phòng</button>
            <button class="btn ghost" id="btnPush" ${rid ? "" : "disabled"}>Đẩy lại dữ liệu</button>
          </div>
          <div class="helper">Dữ liệu vẫn hoạt động offline; khi có mạng sẽ tự đồng bộ hai chiều.</div>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => el.querySelector(sel);
  const statusRid = $("#statusRid");
  const syncStatus = $("#syncStatus");
  const joinCode = $("#joinCode");
  const btnCreate = $("#btnCreate");
  const btnJoin = $("#btnJoin");
  const btnLeave = $("#btnLeave");
  const btnSync = $("#btnSync");
  const btnPush = $("#btnPush");

  const onRemote = throttle(() => {
    const cur = getRoomId();
    statusRid.textContent = cur || "(chưa tham gia)";
  }, 300);
  const statusText = {
    local: "Local",
    syncing: "Đang đồng bộ...",
    synced: "Đã đồng bộ",
    pending: "Có dữ liệu chưa đẩy",
  };
  const updateSyncStatus = (detail = window.__roomSyncStatus || {}) => {
    if (!syncStatus) return;
    syncStatus.textContent = statusText[detail.status] || "Local";
  };
  window.addEventListener("room:sync-status", (e) => updateSyncStatus(e.detail));
  updateSyncStatus();

  if (rid) {
    joinCode.value = rid;
    (async () => {
      try {
        await joinRoom(rid);
        enterRoom(rid, onRemote);
      } catch (e) {
        console.warn("[roomview] restore room failed:", e?.message || e);
      }
    })();
  }

  const setBusy = (busy) => {
    [btnCreate, btnJoin, btnLeave, btnSync, btnPush].forEach((b) => {
      if (!b) return;
      b.disabled = busy || ((b === btnPush || b === btnSync) && !getRoomId());
      if (busy) b.setAttribute("aria-busy", "true");
      else b.removeAttribute("aria-busy");
    });
  };
  btnCreate.addEventListener("click", async () => {
    const out = $("#createOut");
    setBusy(true);
    out.textContent = "";
    const hide = showLoading("Đang tạo phòng...");
    try {
      const id = await createRoom();
      if (id) {
        enterRoom(id, onRemote);
        showToast("Đã tạo phòng: " + id, "success");
        statusRid.textContent = id;
        joinCode.value = id;
        btnSync.disabled = false;
        btnPush.disabled = false;
        onRemote();
      } else {
        showToast("Tạo phòng thất bại.", "error");
      }
    } catch (e) {
      showToast("Lỗi tạo phòng: " + (e?.message || e), "error");
    } finally {
      hide();
      setBusy(false);
    }
  });

  const validCode = (s) => /^[A-Z0-9]{4,12}$/.test(s);
  const doJoin = async () => {
    const out = $("#joinOut");
    const code = (joinCode.value || "").trim().toUpperCase();
    if (!validCode(code)) {
      out.textContent = "Mã phòng không hợp lệ.";
      return;
    }
    setBusy(true);
    out.textContent = "";
    const hide = showLoading("Đang tham gia phòng...");
    try {
      await joinRoom(code);
      enterRoom(code, onRemote);
      showToast(`Đã tham gia phòng ${code}.`, "success");
      statusRid.textContent = code;
      btnSync.disabled = false;
      btnPush.disabled = false;
      onRemote();
    } catch (e) {
      showToast("Lỗi tham gia: " + (e?.message || e), "error");
    } finally {
      hide();
      setBusy(false);
    }
  };

  btnJoin.addEventListener("click", doJoin);
  joinCode.addEventListener("keydown", (e) => {
    if (e.key === "Enter") doJoin();
  });

  btnLeave.addEventListener("click", async () => {
    if (!getRoomId()) {
      showToast("Bạn chưa ở trong phòng.", "info");
      return;
    }

    const ok = confirm(
      "Rời phòng sẽ ngắt đồng bộ và xóa bảng dữ liệu cục bộ của phòng này trên máy hiện tại.\n\n" +
      "Dữ liệu trên phòng online không bị xóa. Bạn có chắc muốn rời phòng?"
    );
    if (!ok) return;

    const shouldBackup = confirm("Tải bản backup JSON ra tệp trước khi rời phòng?");
    if (shouldBackup) {
      const hide = showLoading("Đang tạo tệp backup...");
      try {
        await downloadBackup();
      } catch (e) {
        showToast("Không thể tạo backup: " + (e?.message || e), "error");
        return;
      } finally {
        hide();
      }
    }

    leaveRoom();
    showToast("Đã rời phòng.", "info");
    statusRid.textContent = "(chưa tham gia)";
    btnSync.disabled = true;
    btnPush.disabled = true;
    onRemote();
  });

  btnSync.addEventListener("click", async () => {
    const rid = getRoomId();
    if (!rid) {
      showToast("Bạn chưa ở trong phòng.", "info");
      return;
    }
    setBusy(true);
    const hide = showLoading("Đang đồng bộ phòng...");
    try {
      await pullRoomToLocal(rid);
      await pushPendingRoomChanges(rid);
      enterRoom(rid, onRemote);
      showToast("Đã đồng bộ phòng.", "success");
      onRemote();
    } catch (e) {
      showToast("Lỗi đồng bộ phòng: " + (e?.message || e), "error");
    } finally {
      hide();
      setBusy(false);
    }
  });

  btnPush.addEventListener("click", async () => {
    const out = $("#joinOut");
    if (!getRoomId()) {
      out.textContent = "Bạn chưa ở trong phòng.";
      return;
    }
    setBusy(true);
    const hide = showLoading("Đang đẩy dữ liệu lên phòng...");
    const nextFrame = () => new Promise(requestAnimationFrame);

    try {
      await pushHistoryAll();
      await nextFrame();
      await pushAllToRoom();
      await nextFrame();
      await pushMonthPtr();
      showToast("Đã đẩy toàn bộ dữ liệu lên phòng thành công.", "success");
    } catch (e) {
      showToast("Lỗi đẩy dữ liệu: " + (e?.message || e), "error");
    } finally {
      hide();
      setBusy(false);
    }
  });
}

export default { mount };
