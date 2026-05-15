function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function optionButtons(options) {
  return (options || []).map((opt) => (
    `<button type="button" data-value="${esc(opt.value)}">${esc(opt.label)}</button>`
  )).join("");
}

export function syncCustomSelect(root, targetId) {
  const hidden = root.querySelector(`#${targetId}`);
  const wrap = hidden?.closest(".custom-select");
  const btn = wrap?.querySelector(".custom-select-btn");
  const menu = wrap?.querySelector(".custom-select-menu");
  if (!hidden || !btn || !menu) return;

  const item = Array.from(menu.querySelectorAll("button[data-value]"))
    .find((btnEl) => btnEl.dataset.value === hidden.value);
  if (!item) return;
  btn.dataset.value = hidden.value;
  btn.textContent = item.textContent.trim();
}

export function setupCustomSelect(root, targetId) {
  const hidden = root.querySelector(`#${targetId}`);
  const wrap = hidden?.closest(".custom-select");
  if (!hidden || !wrap || wrap.dataset.ready === "1") return;

  const btn = wrap.querySelector(".custom-select-btn");
  const menu = wrap.querySelector(".custom-select-menu");
  if (!btn || !menu) return;

  const close = () => {
    menu.hidden = true;
    btn.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    root.querySelectorAll(".custom-select-menu").forEach((m) => {
      if (m !== menu) m.hidden = true;
    });
    menu.hidden = false;
    btn.setAttribute("aria-expanded", "true");
  };

  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });

  menu.addEventListener("click", (e) => {
    const item = e.target.closest("button[data-value]");
    if (!item) return;
    e.stopPropagation();
    hidden.value = item.dataset.value || "";
    syncCustomSelect(root, targetId);
    close();
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  });

  hidden.addEventListener("change", () => syncCustomSelect(root, targetId));
  document.addEventListener("click", close);
  wrap.dataset.ready = "1";
  syncCustomSelect(root, targetId);
}
