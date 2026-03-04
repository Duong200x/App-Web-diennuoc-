// src/ui/syncIndicator.js
// Hiển thị chip trạng thái đồng bộ (Online/Offline + hàng đợi Firestore)
// - Tự ẩn khi rảnh rỗi
// - Hiện "Đang đồng bộ…" khi queue đang chạy hoặc còn pending
// - Hiện "Offline – sẽ đồng bộ khi có mạng" khi mất mạng
//
// KHÔNG cần sửa file khác. Chỉ cần import 1 lần ở entry (vd: src/main.js).
// Nếu chưa import, file này không ảnh hưởng gì tới app.
//
// API mở rộng (tuỳ chọn):
//   window.SyncIndicator.start();  // bật theo dõi
//   window.SyncIndicator.stop();   // tắt theo dõi
//
// Ghi chú: Đọc trạng thái từ pushQueue singleton (không cần event emitter).

import pushQueue from "../sync/pushQueue.js"; // đã có ở bước trước

const ID_STYLE = "sync-indicator-style";
const ID_WRAP  = "sync-indicator";
let timer = null;

function ensureStyles() {
  if (document.getElementById(ID_STYLE)) return;
  const st = document.createElement("style");
  st.id = ID_STYLE;
  st.textContent = `
  #${ID_WRAP}{
    position: fixed;
    z-index: 9999;
    right: env(safe-area-inset-right, 0px);
    bottom: calc(env(safe-area-inset-bottom, 0px) + 12px);
    display: none;
    pointer-events: none;
  }
  #${ID_WRAP} .chip{
    display:inline-flex; align-items:center; gap:8px;
    padding:8px 12px;
    border-radius: 999px;
    box-shadow: 0 8px 24px rgba(0,0,0,.15);
    font-size: 13px; font-weight: 700;
    border: 1px solid var(--si-border, rgba(148,163,184,.35));
    background: var(--si-bg, #0b5ed7);
    color: var(--si-fg, #fff);
    pointer-events: auto;
    user-select: none;
    transform: translateY(6px);
    opacity: 0;
    transition: transform .2s ease, opacity .2s ease;
  }
  #${ID_WRAP}.show .chip{ transform:none; opacity:1; }
  #${ID_WRAP} .chip.offline{
    --si-bg: #b91c1c;         /* đỏ */
    --si-border: rgba(239,68,68,.5);
  }
  #${ID_WRAP} .chip.syncing{
    --si-bg: #0b5ed7;         /* xanh dương */
    --si-border: rgba(59,130,246,.45);
  }
  .theme-dark #${ID_WRAP} .chip{
    box-shadow: 0 8px 24px rgba(0,0,0,.35);
  }
  #${ID_WRAP} .dot{
    width:10px; height:10px; border-radius:999px;
    background: currentColor; opacity:.85;
    animation: si-pulse 1.2s ease-in-out infinite;
  }
  #${ID_WRAP} .spinner{
    width:12px; height:12px; border-radius:50%;
    border:2px solid rgba(255,255,255,.35);
    border-top-color:#fff;
    animation: si-spin .9s linear infinite;
  }
  @keyframes si-spin{ to{ transform: rotate(360deg); } }
  @keyframes si-pulse{
    0%,100%{ transform: scale(1); opacity:.85; }
    50%{ transform: scale(1.25); opacity:1; }
  }
  `;
  document.head.appendChild(st);
}

function ensureWrap() {
  let wrap = document.getElementById(ID_WRAP);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = ID_WRAP;
    wrap.innerHTML = `<div class="chip"><span class="icon"></span><span class="txt"></span></div>`;
    document.body.appendChild(wrap);
  }
  return wrap;
}

function isOnline() {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

function readQueueState() {
  // Các thuộc tính nội bộ của pushQueue vẫn truy cập được (JS không có private thực sự)
  const running = pushQueue?.running || 0;
  const pending = pushQueue?.pendingMap ? pushQueue.pendingMap.size : 0;
  return { running, pending };
}

function setState({ mode, text }) {
  const wrap = ensureWrap();
  const chip = wrap.querySelector(".chip");
  const icon = chip.querySelector(".icon");
  const txt  = chip.querySelector(".txt");

  chip.classList.remove("offline", "syncing");

  if (mode === "offline") {
    chip.classList.add("offline");
    icon.className = "icon dot";
    txt.textContent = text || "Offline – sẽ đồng bộ khi có mạng";
    wrap.classList.add("show");
    wrap.style.display = "block";
    return;
  }

  if (mode === "sync") {
    chip.classList.add("syncing");
    icon.className = "icon spinner";
    txt.textContent = text || "Đang đồng bộ…";
    wrap.classList.add("show");
    wrap.style.display = "block";
    return;
  }

  // idle
  wrap.classList.remove("show");
  // cho hiệu ứng mượt, chờ 220ms rồi ẩn hẳn
  setTimeout(() => { wrap.style.display = "none"; }, 220);
}

function refresh() {
  // 1) offline luôn ưu tiên hiển thị
  if (!isOnline()) {
    setState({ mode: "offline" });
    return;
  }
  // 2) online → xem queue
  const { running, pending } = readQueueState();
  const total = running + pending;
  if (total > 0) {
    const text = running > 0
      ? `Đang đồng bộ… (${running} chạy, ${pending} đợi)`
      : `Đang chuẩn bị đồng bộ… (${pending} tác vụ)`;
    setState({ mode: "sync", text });
    return;
  }
  // 3) idle
  setState({ mode: "idle" });
}

function start() {
  ensureStyles();
  ensureWrap();
  stop();
  // tick nhanh hơn khi foreground, chậm hơn khi background
  const baseMs = document.visibilityState === "visible" ? 400 : 1000;
  timer = setInterval(refresh, baseMs);

  window.addEventListener("online", refresh);
  window.addEventListener("offline", refresh);
  document.addEventListener("visibilitychange", () => {
    stop();
    const nextMs = document.visibilityState === "visible" ? 400 : 1000;
    timer = setInterval(refresh, nextMs);
    refresh();
  });

  // chạy 1 lần ngay
  refresh();
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

function autoMount() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
}

// Xuất API (tuỳ chọn dùng từ console)
if (typeof window !== "undefined") {
  window.SyncIndicator = {
    start, stop, refresh,
    get state() { return readQueueState(); },
  };
}

autoMount();
export default { start, stop, refresh };
