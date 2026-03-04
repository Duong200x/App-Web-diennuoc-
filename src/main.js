// src/main.js
import "./style.css";

import { startRouter } from "./router.js";
import { rolloverMonth } from "./state/history.js";
import { initFirebase } from "./sync/firebase.js";
import { isInRoom, subscribeRoom } from "./sync/room.js";
import { recomputePrevDebtFromHistory } from "./state/readings.js";
import "./ui/syncIndicator.js";
import "./routes/backupOverlay.js";
import "./ui/backupFab.js";

/* ========= Theme management ========= */
const THEME_KEY = "app-theme";
function getSavedTheme() {
  try { return localStorage.getItem(THEME_KEY) || "light"; } catch { return "light"; }
}
function saveTheme(theme) {
  try { localStorage.setItem(THEME_KEY, theme); } catch {}
}
async function applyTheme(theme) {
  const html = document.documentElement;
  const isDark = theme === "dark";
  html.classList.toggle("theme-dark", isDark);

  // Đổi icon trên nút bóng đèn
  const lightIcon = document.querySelector("#theme-toggle .icon-light");
  const darkIcon  = document.querySelector("#theme-toggle .icon-dark");
  if (lightIcon && darkIcon) {
    lightIcon.style.display = isDark ? "none" : "";
    darkIcon.style.display  = isDark ? "" : "none";
  }

  // Đồng bộ StatusBar trên Android (Capacitor v5)
  try {
    const { Capacitor } = await import("@capacitor/core");
    const isNative = (Capacitor?.getPlatform?.() ?? "web") !== "web";
    if (isNative) {
      const { StatusBar, Style } = await import("@capacitor/status-bar");
      await StatusBar.setOverlaysWebView({ overlay: false });
      if (isDark) {
        await StatusBar.setBackgroundColor({ color: "#151a21" });
        await StatusBar.setStyle({ style: Style.Light });
      } else {
        await StatusBar.setBackgroundColor({ color: "#ffffff" });
        await StatusBar.setStyle({ style: Style.Dark });
      }
      html.classList.add("native");
      window.__IS_NATIVE__ = true;
    } else {
      window.__IS_NATIVE__ = false;
    }
  } catch {}
}
async function toggleTheme() {
  const next = getSavedTheme() === "dark" ? "light" : "dark";
  saveTheme(next);
  await applyTheme(next);
}

/* ========= Áp dụng theme ngay khi khởi chạy ========= */
(async () => {
  await applyTheme(getSavedTheme());
})();

/* ========= PWA SW: chỉ chạy trên web ========= */
(async () => {
  try {
    const { Capacitor } = await import("@capacitor/core");
    const isNative = (Capacitor?.getPlatform?.() ?? "web") !== "web";
    if (!isNative) {
      const { registerSW } = await import("virtual:pwa-register");
      const updateSW = registerSW({
        onNeedRefresh() { if (confirm("Đã có phiên bản mới. Tải lại ngay?")) updateSW(true); },
        onOfflineReady() { console.log("App đã sẵn sàng chạy offline."); },
      });
    }
  } catch { /* apk mode dùng shim */ }
})();

/* ========= Nếu chưa có hash thì về list ========= */
if (!location.hash) location.hash = "#/list";

/* ========= Hard refresh về trang chính khi bấm tiêu đề ========= */
// Xoá vài state tạm để không khôi phục UI cũ rồi reload (tương đương F5)
function hardRefreshToHome() {
  try {
    sessionStorage.removeItem("list.ui");
    sessionStorage.removeItem("history.ui");
    sessionStorage.removeItem("history.selectedKey");
    sessionStorage.removeItem("history.lastSavedKey");
    sessionStorage.removeItem("history.lastSavedUntil");
  } catch {}
  const homeHash = "#/list";
  if (location.hash !== homeHash) {
    location.replace(`${location.pathname}${location.search}${homeHash}`);
  }
  // Xoá cache PWA (nếu có) rồi reload — giúp chữa các trường hợp webview giữ cache cũ
  const doReload = () => location.reload();
  if ("caches" in window) {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .finally(doReload)
      .catch(doReload);
  } else {
    doReload();
  }
}
// Gắn listener cho link tiêu đề (dùng nhiều selector cho chắc)
function bindHomeHardRefresh() {
  document.addEventListener("click", (ev) => {
    const homeLink = ev.target.closest("#appHomeLink, .app-title a, header .app-title a");
    if (!homeLink) return;
    ev.preventDefault();
    hardRefreshToHome();
  }, true);
}

/* ========= Khởi động ứng dụng ========= */
window.addEventListener("DOMContentLoaded", () => {
  const app = document.getElementById("app");
  bindHomeHardRefresh();

  // Re-render helper (debounce 1 frame) + luôn dồn nợ trước khi render
  let pending = false;
  window.__forceRender = () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      try { recomputePrevDebtFromHistory(); } catch {}
      startRouter(app);
      pending = false;
    });
  };

  // Start
  rolloverMonth();
  try { recomputePrevDebtFromHistory(); } catch {}
  window.__forceRender();

  // Firebase realtime
  initFirebase();

  // --- FIX: join room xong không thấy dữ liệu cho tới khi restart ---
  // Cơ chế: thử đăng ký subscribe khi phát hiện đã join room (kể cả join sau)
  let roomSubStarted = false;
  const startRoomSub = () => {
    if (roomSubStarted) return;
    if (!isInRoom()) return;
    roomSubStarted = true;
    subscribeRoom(() => {
      try { recomputePrevDebtFromHistory(); } catch {}
      window.__forceRender();
    });
  };
  // Thử ngay bây giờ, và thử lại định kỳ tới khi thành công
  startRoomSub();
  const roomProbe = setInterval(() => {
    if (roomSubStarted) { clearInterval(roomProbe); return; }
    startRoomSub();
  }, 1200);
  // Khi cửa sổ lấy lại focus cũng kiểm tra
  window.addEventListener("focus", startRoomSub);

  // Theme toggle
  const themeBtn = document.getElementById("theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", () => { toggleTheme(); });

  // Hamburger menu toggle
  const menuBtn = document.getElementById("menu-toggle");
  const menuPanel = document.getElementById("side-menu");
  if (menuBtn && menuPanel) {
    const closeMenu = () => { menuPanel.setAttribute("hidden", ""); document.removeEventListener("click", onDoc); };
    const onDoc = (e) => { if (!menuPanel.contains(e.target) && e.target !== menuBtn) closeMenu(); };
    menuBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (menuPanel.hasAttribute("hidden")) {
        menuPanel.removeAttribute("hidden");
        setTimeout(() => document.addEventListener("click", onDoc), 0);
      } else { closeMenu(); }
    });
    menuPanel.addEventListener("click", (e) => {
      const a = e.target.closest("a"); if (a) closeMenu();
    });
  }

  // Log trạng thái mạng
  window.addEventListener("online",  () => console.log("Đang online, sẽ tự đồng bộ."));
  window.addEventListener("offline", () => console.log("Mất mạng, ghi tạm offline."));
});
