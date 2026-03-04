// src/ui/busy.js
function ensureBusyStyles() {
  if (document.getElementById("busy-style")) return;
  const css = `
    .busy-overlay{
      position: fixed; inset: 0; z-index: 9999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,.45);
      -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
    }
    .busy-box{
      min-width: 200px; max-width: 80vw;
      padding: 16px 18px; border-radius: 12px;
      background: #0f172a; color: #fff; /* hợp dark mode */
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
      display: flex; gap: 12px; align-items: center;
      font-size: 15px;
    }
    .busy-spinner{
      width: 22px; height: 22px; border-radius: 50%;
      border: 3px solid rgba(255,255,255,.25);
      border-top-color: #fff; animation: busy-rot 0.8s linear infinite;
      flex: 0 0 auto;
    }
    @keyframes busy-rot{ to{ transform: rotate(360deg); } }
    .busy-msg{ line-height: 1.35; }
  `;
  const st = document.createElement("style");
  st.id = "busy-style";
  st.textContent = css;
  document.head.appendChild(st);
}

/** Hiện overlay loading, trả về hàm hide() để đóng */
export function showLoading(message = "Đang xử lý...") {
  ensureBusyStyles();
  const wrap = document.createElement("div");
  wrap.className = "busy-overlay";
  wrap.innerHTML = `
    <div class="busy-box" role="status" aria-live="polite">
      <div class="busy-spinner" aria-hidden="true"></div>
      <div class="busy-msg">${message}</div>
    </div>
  `;
  document.body.appendChild(wrap);

  // trả về hàm đóng
  let closed = false;
  return function hide() {
    if (closed) return;
    closed = true;
    try { document.body.removeChild(wrap); } catch {}
  };
}

/** Bọc 1 Promise với overlay loading */
export async function withLoading(promiseOrFn, message = "Đang xử lý...") {
  const hide = showLoading(message);
  try {
    const p = typeof promiseOrFn === "function" ? promiseOrFn() : promiseOrFn;
    return await p;
  } finally {
    hide();
  }
}
