// src/router.js
import * as ListView     from "./views/ListView.js";
import * as FormView     from "./views/FormView.js";
import * as HistoryView  from "./views/HistoryView.js";
import * as ConfigView   from "./views/ConfigView.js";
import * as TemplateView from "./views/TemplateView.js";
import * as DetailView   from "./views/DetailView.js";
import * as ManageView   from "./views/ManageView.js";
import * as RoomView     from "./views/RoomView.js";

export function startRouter(appEl) {
  const routes = {
    "#/list":     { type: "list" },
    "#/add":      { view: FormView },
    "#/history":  { view: HistoryView },
    "#/config":   { view: ConfigView },
    "#/template": { view: TemplateView },
    "#/room":     { view: RoomView },
  };

  let listHost = null;

  const normalize = (h) => (!h || h === "#" || h === "#/") ? "#/list" : h;

  // ========== Overlay toàn màn hình (fixed) – nhưng không che topbar ==========
  function topbarHeight() {
    const tb = document.querySelector(".topbar");
    return tb ? tb.getBoundingClientRect().height : 0;
  }

  function ensureOverlay() {
    let ov = document.getElementById("route-overlay");
    if (!ov) {
      ov = document.createElement("div");
      ov.id = "route-overlay";
      const inner = document.createElement("div");
      inner.id = "route-overlay-content";
      ov.appendChild(inner);
      document.body.appendChild(ov);
    }
    const t = topbarHeight();
    ov.style.paddingTop = t + "px";
    // Force update CSS variable for side-menu positioning
    document.documentElement.style.setProperty("--topbar-h", t + "px");
    return ov;
  }

  function showOverlay() {
    const ov = ensureOverlay();
    ov.removeAttribute("hidden");
    // chặn cuộn nền (không đổi scrollTop của List)
    document.body.style.overflow = "hidden";
    const inner = ov.querySelector("#route-overlay-content");
    inner.innerHTML = ""; // dọn trước khi mount
    return inner;
  }

  function hideOverlay() {
    const ov = document.getElementById("route-overlay");
    if (ov) {
      ov.setAttribute("hidden", "true");
      const inner = ov.querySelector("#route-overlay-content");
      if (inner) inner.innerHTML = "";
    }
    // cho cuộn body lại (List giữ nguyên vị trí)
    document.body.style.overflow = "";
  }

  // ========== List mount 1 lần ==========
  function mountListOnce() {
    if (listHost) return;
    listHost = document.createElement("div");
    listHost.id = "list-host";
    appEl.appendChild(listHost);
    ListView.mount(listHost);
  }

  // ========== Render ==========
  function _render() {
    const hash = normalize(location.hash);
    mountListOnce();

    // route động
    if (hash.startsWith("#/detail/")) {
      const idx = Number(hash.split("/")[2]);
      const target = showOverlay();
      DetailView.mount(target, idx);
      return;
    }
    if (hash.startsWith("#/manage/")) {
      const idx = Number(hash.split("/")[2]);
      const target = showOverlay();
      ManageView.mount(target, idx);
      return;
    }

    // route tĩnh
    const r = routes[hash];
    if (!r || r.type === "list") {
      hideOverlay(); // quay về list: ẩn overlay, không đụng List
      return;
    }
    const target = showOverlay();
    r.view.mount(target);
  }

  const render = () => requestAnimationFrame(_render);

  // Chỉ gắn listener nếu chưa có (tránh duplicate khi hot reload hoặc gọi nhầm)
  if (!window.__ROUTER_INIT__) {
    window.addEventListener("hashchange", render, { passive: true });
    window.addEventListener("load", render);
    window.addEventListener("resize", () => {
      const ov = document.getElementById("route-overlay");
      if (ov && !ov.hasAttribute("hidden")) {
        ov.style.top = topbarHeight() + "px";
      }
    });
    // Lắng nghe event force-render từ main.js
    window.addEventListener("app:force-render", render);
    window.__ROUTER_INIT__ = true;
  }

  render();
}
