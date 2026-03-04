// src/views/roomview.js
import {
  createRoom,
  enterRoom,
  leaveRoom,
  getRoomId,
  pushAllToRoom,
  pushHistoryAll,
  pushMonthPtr,
} from "../sync/room.js";
import { showLoading } from "../ui/busy.js";

/* ========= helpers ========= */
function throttle(fn, ms = 300) {
  let t = 0, timer = null;
  return (...args) => {
    const now = Date.now();
    const wait = ms - (now - t);
    if (wait <= 0) {
      t = now;
      fn(...args);
    } else {
      clearTimeout(timer);
      timer = setTimeout(() => { t = Date.now(); fn(...args); }, wait);
    }
  };
}

function ensureRoomCss() {
  if (document.getElementById("room-anti-jitter")) return;
  const st = document.createElement("style");
  st.id = "room-anti-jitter";
  st.textContent = `
    /* Chỉ áp trong page này để tránh layout shift khi hover */
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
            <button class="btn" id="btnCreate">Tạo phòng mới</button>
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
          <div class="toolbar" style="justify-content:flex-end;">
            <button class="btn ghost" id="btnPush" ${rid ? "" : "disabled"}>Đẩy toàn bộ dữ liệu hiện tại lên phòng</button>
          </div>
          <div class="helper">Dữ liệu vẫn hoạt động offline; khi có mạng sẽ tự đồng bộ hai chiều.</div>
        </div>
      </div>
    </div>
  `;

  const $ = (sel) => el.querySelector(sel);
  const statusRid = $("#statusRid");
  const joinCode  = $("#joinCode");
  const btnCreate = $("#btnCreate");
  const btnJoin   = $("#btnJoin");
  const btnLeave  = $("#btnLeave");
  const btnPush   = $("#btnPush");

  // 🔧 Thay vì re-render toàn app, chỉ cập nhật text trạng thái nhẹ nhàng (throttle)
  const onRemote = throttle(() => {
    const cur = getRoomId();
    statusRid.textContent = cur || "(chưa tham gia)";
    // KHÔNG gọi window.__forceRender() để tránh giật UI trang này
  }, 300);

  if (rid) {
    joinCode.value = rid;
    // Đảm bảo đã subscribe nếu có RID trong storage
    // enterRoom có thể tự idempotent; nếu đã vào phòng rồi thì chỉ cập nhật listener.
    enterRoom(rid, onRemote);
  }

  const setBusy = (busy) => {
    [btnCreate, btnJoin, btnLeave, btnPush].forEach((b) => {
      if (!b) return;
      b.disabled = busy || (b === btnPush && !getRoomId());
      if (busy) b.setAttribute("aria-busy", "true"); else b.removeAttribute("aria-busy");
    });
  };

  // ====== Tạo phòng ======
  btnCreate.addEventListener("click", async () => {
    const out = $("#createOut");
    setBusy(true);
    out.textContent = "";
    const hide = showLoading("Đang tạo phòng...");
    try {
      const id = await createRoom(); // (giữ logic gốc: đã push residents+history+month)
      if (id) {
        enterRoom(id, onRemote);
        out.textContent = "Đã tạo phòng: " + id + " (chia sẻ mã này cho người khác)";
        statusRid.textContent = id;
        joinCode.value = id;
        btnPush.disabled = false;
        onRemote();
      } else {
        out.textContent = "Tạo phòng thất bại. Vui lòng kiểm tra mạng/Firebase.";
      }
    } catch (e) {
      out.textContent = "Lỗi tạo phòng: " + (e?.message || e);
    } finally {
      hide();
      setBusy(false);
    }
  });

  // ====== Tham gia ======
  const validCode = (s) => /^[A-Z0-9]{4,12}$/.test(s);
  const doJoin = async () => {
    const out = $("#joinOut");
    const code = (joinCode.value || "").trim().toUpperCase();
    if (!validCode(code)) { out.textContent = "Mã phòng không hợp lệ."; return; }
    setBusy(true);
    out.textContent = "";
    const hide = showLoading("Đang tham gia phòng...");
    try {
      enterRoom(code, onRemote); // bật realtime, dữ liệu đổ về tự động
      out.textContent = `Đã tham gia phòng ${code}. Dữ liệu sẽ tự đồng bộ.`;
      statusRid.textContent = code;
      btnPush.disabled = false;
      onRemote();
    } catch (e) {
      out.textContent = "Lỗi tham gia: " + (e?.message || e);
    } finally {
      hide();
      setBusy(false);
    }
  };
  btnJoin.addEventListener("click", doJoin);
  joinCode.addEventListener("keydown", (e) => { if (e.key === "Enter") doJoin(); });

  // ====== Rời phòng ======
  btnLeave.addEventListener("click", () => {
    leaveRoom();
    $("#joinOut").textContent = "Đã rời phòng.";
    statusRid.textContent = "(chưa tham gia)";
    btnPush.disabled = true;
    onRemote();
  });

  // ====== Đẩy toàn bộ ======
  btnPush.addEventListener("click", async () => {
    const out = $("#joinOut");
    if (!getRoomId()) { out.textContent = "Bạn chưa ở trong phòng."; return; }
    setBusy(true);
    const hide = showLoading("Đang đẩy dữ liệu lên phòng...");

    // Nhả khung hình giữa các chặng để UI không bị đơ (nhất là Android)
    const nextFrame = () => new Promise(requestAnimationFrame);

    try {
      // Lịch sử trước → danh sách hiện tại → con trỏ tháng
      await pushHistoryAll();
      await nextFrame();
      await pushAllToRoom();
      await nextFrame();
      await pushMonthPtr();

      out.textContent = "Đã đẩy toàn bộ (danh sách + lịch sử + tháng) lên phòng.";
    } catch (e) {
      out.textContent = "Lỗi: " + (e?.message || e);
    } finally {
      hide();
      setBusy(false);
    }
  });
}
