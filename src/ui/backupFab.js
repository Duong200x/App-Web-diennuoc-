// src/ui/backupFab.js
// Nút nổi mở màn hình Sao lưu/Khôi phục (#/backup).
// - Bật/tắt: localStorage key "ui.backupFab.enabled" (mặc định true)
//            hoặc gọi window.BackupFab.setEnabled(true/false)
// - Kéo/thả: lưu vị trí tại "ui.backupFab.pos" -> { left, top } (px)
//
// Cách dùng: import "./ui/backupFab.js";

const ID_STYLE = "backup-fab-style";
const ID_BTN   = "backup-fab-btn";
const LS_ENABLED = "ui.backupFab.enabled";
const LS_POS     = "ui.backupFab.pos";

function getEnabled() {
  const v = localStorage.getItem(LS_ENABLED);
  return v == null ? true : v === "1" || v === "true";
}
function setEnabled(val) {
  localStorage.setItem(LS_ENABLED, val ? "1" : "0");
  applyVisibility();
  try { window.dispatchEvent(new CustomEvent("backupfab:enabled-changed", { detail: !!val })); } catch {}
}

function getSavedPos() {
  try {
    const raw = localStorage.getItem(LS_POS);
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (Number.isFinite(p?.left) && Number.isFinite(p?.top)) return p;
    return null;
  } catch { return null; }
}
function savePos(p) {
  try { localStorage.setItem(LS_POS, JSON.stringify(p)); } catch {}
}

function ensureStyles() {
  if (document.getElementById(ID_STYLE)) return;
  const st = document.createElement("style");
  st.id = ID_STYLE;
  st.textContent = `
    #${ID_BTN}{
      position: fixed;
      right: calc(env(safe-area-inset-right, 0px) + 16px);
      bottom: calc(env(safe-area-inset-bottom, 0px) + 24px);
      z-index: 9997;
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 12px;
      border-radius: 999px;
      background: #0b5ed7; color: #fff; font-weight: 800; font-size: 13px;
      border: 1px solid rgba(59,130,246,.4);
      box-shadow: 0 12px 28px rgba(0,0,0,.22);
      cursor: grab; user-select: none;
      touch-action: none; /* quan trọng cho pointer events */
      transform: translateY(4px); opacity: .98;
      transition: transform .18s ease, opacity .18s ease, box-shadow .18s ease;
    }
    #${ID_BTN}:hover{ transform: translateY(0); opacity: 1; }
    #${ID_BTN}.dragging{ cursor: grabbing; box-shadow: 0 16px 40px rgba(0,0,0,.32); transition: none; }
    .theme-dark #${ID_BTN}{ box-shadow: 0 12px 28px rgba(0,0,0,.36); }

    #${ID_BTN} .ic{
      width: 16px; height: 16px; border-radius: 3px;
      background: currentColor; mask: var(--mask) center/16px 16px no-repeat;
      -webkit-mask: var(--mask) center/16px 16px no-repeat;
      --mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="white" viewBox="0 0 24 24"><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm9.4 4a7.4 7.4 0 0 0-.13-1.34l2.11-1.65a.5.5 0 0 0 .12-.63l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.55 7.55 0 0 0-2.31-1.34l-.38-2.65A.5.5 0 0 0 12.95 0h-4a.5.5 0 0 0-.5.42l-.38 2.65a7.55 7.55 0 0 0-2.31 1.34l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.63L2.4 10.66A7.4 7.4 0 0 0 2.27 12c0 .45.05.89.13 1.34l-2.11 1.65a.5.5 0 0 0-.12.63l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.7.55 1.48 1 2.31 1.34l.38 2.65a.5.5 0 0 0 .5.42h4a.5.5 0 0 0 .5-.42l.38-2.65c.83-.34 1.61-.79 2.31-1.34l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.63l-2.11-1.65c.08-.45.13-.89.13-1.34Z"/></svg>');
    }

    /* nếu bạn có overlay thực sự thì selector này mới có tác dụng */
    body.backup-overlay-open #${ID_BTN}{ display: none !important; }
  `;
  document.head.appendChild(st);
}

function openBackup() {
  if ((location.hash || "") !== "#/backup") {
    location.hash = "#/backup";
  } else {
    // ép router render lại nếu đang ở đúng route
    try { window.dispatchEvent(new HashChangeEvent("hashchange")); } catch {}
  }
}

function ensureBtn() {
  if (document.getElementById(ID_BTN)) return;

  const btn = document.createElement("button");
  btn.id = ID_BTN;
  btn.type = "button";
  btn.innerHTML = `<span class="ic" aria-hidden="true"></span><span>Sao lưu/Khôi phục</span>`;

  // Vị trí đã lưu
  const pos = getSavedPos();
  if (pos) {
    btn.style.left = `${pos.left}px`;
    btn.style.top  = `${pos.top}px`;
    btn.style.right = "auto";
    btn.style.bottom = "auto";
  }

  // Pointer Events: tap -> mở, drag -> kéo
  const DRAG_THRESHOLD = 6; // px

  let start = null;
  let dragging = false;

  const setAbsPosFromRect = () => {
    const rect = btn.getBoundingClientRect();
    btn.style.left = `${rect.left}px`;
    btn.style.top  = `${rect.top}px`;
    btn.style.right = "auto";
    btn.style.bottom = "auto";
    return rect;
  };

  btn.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;

    btn.setPointerCapture(ev.pointerId);

    const rect = btn.getBoundingClientRect();
    start = {
      id: ev.pointerId,
      x: ev.clientX,
      y: ev.clientY,
      left: rect.left,
      top: rect.top,
    };
    dragging = false;
  });

  btn.addEventListener("pointermove", (ev) => {
    if (!start || ev.pointerId !== start.id) return;

    const dx = ev.clientX - start.x;
    const dy = ev.clientY - start.y;

    if (!dragging) {
      const dist = Math.hypot(dx, dy);
      if (dist < DRAG_THRESHOLD) return;
      dragging = true;
      btn.classList.add("dragging");
      // chuyển sang left/top tuyệt đối trước khi kéo
      setAbsPosFromRect();
    }

    const rect = btn.getBoundingClientRect();
    const bw = rect.width;
    const bh = rect.height;

    const w = window.innerWidth;
    const h = window.innerHeight;

    const left = Math.max(8, Math.min(start.left + dx, w - bw - 8));
    const top  = Math.max(8, Math.min(start.top  + dy, h - bh - 8));

    btn.style.left = `${left}px`;
    btn.style.top  = `${top}px`;
  });

  const endPointer = (ev) => {
    if (!start || ev.pointerId !== start.id) return;

    try { btn.releasePointerCapture(ev.pointerId); } catch {}

    if (dragging) {
      btn.classList.remove("dragging");
      savePos({ left: parseFloat(btn.style.left || "0"), top: parseFloat(btn.style.top || "0") });
    } else {
      // tap
      openBackup();
    }

    start = null;
    dragging = false;
  };

  btn.addEventListener("pointerup", endPointer);
  btn.addEventListener("pointercancel", () => {
    start = null;
    dragging = false;
    btn.classList.remove("dragging");
  });

  document.body.appendChild(btn);
}

function shouldShowOnHash(h) {
  const ok = ["#/list", "#/history", "#/config", "#/template", "#/room", "#/add"];
  if (h === "" || h === "#" || h === "#/") return true;
  return ok.some((p) => h.startsWith(p));
}

function applyVisibility() {
  const btn = document.getElementById(ID_BTN);
  if (!btn) return;
  const h = (location.hash || "").trim();
  const visible = getEnabled() && shouldShowOnHash(h);
  btn.style.display = visible ? "inline-flex" : "none";
}

function watchOverlay() {
  // Nếu bạn không có element #backup-overlay thì đoạn này không làm gì (không gây lỗi).
  const mo = new MutationObserver(() => {
    const opened = !!document.querySelector("#backup-overlay.show");
    document.body.classList.toggle("backup-overlay-open", opened);
  });
  mo.observe(document.body, { attributes: true, subtree: true });
}

function autoInit() {
  ensureStyles();
  ensureBtn();
  applyVisibility();
  watchOverlay();

  window.addEventListener("hashchange", applyVisibility);
  window.addEventListener("resize", () => {
    const btn = document.getElementById(ID_BTN);
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    if (btn.style.left && btn.style.top) {
      const w = innerWidth, h = innerHeight;
      const left = Math.max(8, Math.min(rect.left, w - rect.width - 8));
      const top  = Math.max(8, Math.min(rect.top , h - rect.height - 8));
      btn.style.left = `${left}px`;
      btn.style.top  = `${top}px`;
      savePos({ left, top });
    }
  });

  if (typeof window !== "undefined") {
    window.BackupFab = {
      setEnabled,
      getEnabled,
      show: () => setEnabled(true),
      hide: () => setEnabled(false),
    };
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInit, { once: true });
} else {
  autoInit();
}

export default {};
