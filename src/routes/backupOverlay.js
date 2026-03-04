// Overlay toàn màn cho trang Sao lưu & Khôi phục (hash: "#/backup" hoặc "#/backups").
// Cách dùng: import "./routes/backupOverlay.js"; rồi điều hướng tới #/backup

import * as BackupView from "../views/backupview.js";

const ID_STYLE = "backup-overlay-style";
const ID_WRAP  = "backup-overlay";
let mounted = false;
let isLockedScroll = false;
let prevOverflow = "";

/* ===== helpers ===== */
function lockScroll() {
  if (isLockedScroll) return;
  const root = document.documentElement;
  prevOverflow = root.style.overflow;
  root.style.overflow = "hidden";
  isLockedScroll = true;
}
function unlockScroll() {
  if (!isLockedScroll) return;
  const root = document.documentElement;
  root.style.overflow = prevOverflow || "";
  isLockedScroll = false;
}
function isBackupHash(h) {
  // chấp nhận cả #/backup và #/backups
  return h === "#/backup" || h === "#/backups";
}
function goBackOneStepOrList() {
  if (window.history.length > 1) {
    try { history.back(); return; } catch {}
  }
  location.hash = "#/list";
}

function ensureStyles() {
  if (document.getElementById(ID_STYLE)) return;
  const st = document.createElement("style");
  st.id = ID_STYLE;
  st.textContent = `
    #${ID_WRAP}{
      position: fixed; inset: 0;
      background: rgba(15, 23, 42, .55);
      backdrop-filter: saturate(120%) blur(8px);
      z-index: 9998;
      display: none;
      align-items: center; justify-content: center;
      padding: max(16px, env(safe-area-inset-top)) max(16px, env(safe-area-inset-right))
               max(16px, env(safe-area-inset-bottom)) max(16px, env(safe-area-inset-left));
    }
    #${ID_WRAP}.show{ display:flex; }
    #${ID_WRAP} .panel{
      width: min(1080px, 96vw);
      max-height: 92vh;
      overflow: auto;
      border-radius: 18px;
      background: var(--card, #0b1220);
      color: var(--fg, #e5e7eb);
      border: 1px solid rgba(148,163,184,.25);
      box-shadow: 0 24px 80px rgba(0,0,0,.35);
      transform: translateY(8px);
      opacity: 0;
      transition: transform .18s ease, opacity .18s ease;
    }
    #${ID_WRAP}.show .panel{ transform:none; opacity:1; }
    /* Thiết lập token màu cho 2 theme và ÉP con kế thừa màu chữ */
    .theme-dark #${ID_WRAP} .panel{ --card:#0b1220; --fg:#e5e7eb; }
    .theme-light #${ID_WRAP} .panel{ --card:#ffffff; --fg:#111827; }
    #${ID_WRAP} .panel, 
    #${ID_WRAP} .panel * { color: var(--fg, #111827); }

    #${ID_WRAP} .head{
      display:flex; justify-content:space-between; align-items:center;
      position: sticky; top:0; z-index:1;
      padding: 10px 14px; border-bottom:1px solid rgba(148,163,184,.2);
      background: color-mix(in oklab, var(--card) 92%, transparent);
      backdrop-filter: blur(4px);
      border-top-left-radius: 18px; border-top-right-radius: 18px;
    }
    #${ID_WRAP} .head h3{ margin:0; font-size:16px; font-weight:800; letter-spacing:.2px; }
    #${ID_WRAP} .close{
      appearance:none; border:0; outline:0; cursor:pointer;
      padding:8px 12px; border-radius: 10px;
      background: rgba(148,163,184,.12); color: inherit; font-weight:700;
      border:1px solid rgba(148,163,184,.28);
    }
    #${ID_WRAP} .content{ padding: 6px 12px 14px; }
    @media (max-width:600px){
      #${ID_WRAP} .panel{ width: 98vw; }
    }
  `;
  document.head.appendChild(st);
}

function ensureWrap() {
  let wrap = document.getElementById(ID_WRAP);
  if (!wrap) {
    wrap = document.createElement("div");
    wrap.id = ID_WRAP;
    wrap.innerHTML = `
      <div class="panel" role="dialog" aria-modal="true" aria-label="Sao lưu & Khôi phục">
        <div class="head">
          <h3>Sao lưu & Khôi phục</h3>
          <button class="close" title="Đóng (Esc)">Đóng</button>
        </div>
        <div class="content">
          <div id="backupViewMount"></div>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    // nút đóng
    wrap.querySelector(".close").addEventListener("click", () => {
      if (isBackupHash(location.hash || "")) goBackOneStepOrList();
      closeOverlay();
    });

    // click nền để đóng
    wrap.addEventListener("click", (e) => {
      if (e.target === wrap) {
        if (isBackupHash(location.hash || "")) goBackOneStepOrList();
        closeOverlay();
      }
    });

    // Esc để đóng
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && isOpen()) {
        if (isBackupHash(location.hash || "")) goBackOneStepOrList();
        closeOverlay();
      }
    });
  }
  return wrap;
}

function isOpen() {
  const wrap = document.getElementById(ID_WRAP);
  return !!(wrap && wrap.classList.contains("show"));
}

function openOverlay() {
  ensureStyles();
  const wrap = ensureWrap();

  if (!mounted) {
    const mountEl = wrap.querySelector("#backupViewMount");
    try {
      BackupView.mount(mountEl);
      mounted = true;
    } catch (e) {
      console.error("[backupOverlay] mount failed:", e);
      mountEl.innerHTML = `<div class="container"><div class="card"><div class="helper">Không thể mở giao diện sao lưu. ${e?.message || e}</div></div></div>`;
    }
  }

  lockScroll();
  wrap.classList.add("show");
}

function closeOverlay() {
  const wrap = document.getElementById(ID_WRAP);
  if (!wrap) return;
  wrap.classList.remove("show");
  unlockScroll();
}

function onHashChange() {
  const h = (location.hash || "").trim();
  if (isBackupHash(h)) {
    openOverlay();
  } else if (isOpen()) {
    closeOverlay();
  }
}

function autoInit() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onHashChange, { once: true });
  } else {
    onHashChange();
  }
  window.addEventListener("hashchange", onHashChange);
}

// Xuất API phụ (nếu cần)
if (typeof window !== "undefined") {
  window.BackupOverlay = { open: openOverlay, close: closeOverlay, isOpen };
}

autoInit();
export default { open: openOverlay, close: closeOverlay, isOpen };
