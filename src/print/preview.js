// src/print/preview.js
import { buildReceiptData, printReceiptWithOptions } from "./receipt.js";
import { loadTemplate, renderPreview } from "./template.js";
import { escapeHTML as esc } from "../utils/html.js";

function isNative() {
  try {
    const C = window.Capacitor;
    if (C?.isNativePlatform) return C.isNativePlatform();
    const p = C?.getPlatform?.();
    return p && p !== "web";
  } catch { return false; }
}

/* ===== CSS: modal ở giữa, 1 thanh cuộn (web + APK) ===== */
function ensurePreviewStyles() {
  if (document.getElementById("pv-style-unified")) return;
  const css = `
    .preview-backdrop{position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000;}
    .preview-modal{
      position:fixed; z-index:1001;
      top:50%; left:50%; transform:translate(-50%,-50%);
      width:min(92vw, 720px); max-height:min(92vh, 700px);
      display:flex; flex-direction:column; overflow:hidden;
    }
    .preview-modal.card{ max-width:none; }
    .preview-modal h2{ margin:0 0 10px; }
    .pv-body{
      flex:1 1 auto; overflow:auto; padding-right:2px;
      -webkit-overflow-scrolling:touch; touch-action:pan-y;
    }
    .mono-preview{
      white-space:pre;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size:12px; line-height:1.35;
      background: rgba(148,163,184,.08);
      border:1px solid rgba(148,163,184,.25);
      border-radius:10px; padding:10px; margin-top:6px;
      overflow:visible; max-height:none;
    }
    .pv-actions{
      position:sticky; bottom:0;
      display:flex; gap:8px; justify-content:flex-end;
      padding-top:10px; margin-top:10px;
      background:inherit; box-shadow:0 -8px 16px rgba(0,0,0,.12);
    }
    .kv-row{ display:flex; gap:10px; align-items:center; }
    .muted{ opacity:.75; font-size:12px; }
    .qr-box{
      margin-top:10px;
      border:1px solid rgba(148,163,184,.25);
      border-radius:12px;
      padding:10px;
      background: rgba(148,163,184,.06);
    }
    .qr-row{ display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .qr-img{
      width:160px; height:160px; object-fit:contain;
      background:#fff; border-radius:8px; padding:6px;
      border:1px solid rgba(0,0,0,.08);
    }
    .qr-text{ width:100%; min-height:70px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size:12px; }
    @media (max-width:480px){ .preview-modal{ width:96vw; max-height:96vh; } }
  `;
  const st = document.createElement("style");
  st.id = "pv-style-unified";
  st.textContent = css;
  document.head.appendChild(st);
}

/* ===== Mặc định & Storage keys ===== */
const DEFAULTS = { COLS: 21, FONT: 17, COPIES: 1 };
const K = {
  COLS: "print_cols",
  FONT: "print_font",
  COPIES: "print_copies",
  QR_ON: "print_qr_on",
  QR_PAYLOAD: "print_qr_payload",
  QR_SIZE: "print_qr_size",
  QR_ECC: "print_qr_ecc",
};
const BASE_COLS = { A: 32, B: 42 };

/* helpers localStorage */
const getNum = (key, fallback) => {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch { return fallback; }
};
const setNum = (key, val) => { try { localStorage.setItem(key, String(val)); } catch {} };
const getStr = (key, fallback = "") => { try { const v = localStorage.getItem(key); return v ?? fallback; } catch { return fallback; } };
const setStr = (key, val) => { try { localStorage.setItem(key, String(val ?? "")); } catch {} };
const getBool = (key, fallback = false) => {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return fallback;
    return v === "1" || v === "true";
  } catch { return fallback; }
};
const setBool = (key, val) => { try { localStorage.setItem(key, val ? "1" : "0"); } catch {} };

/* ===== override theo combo font/size ===== */
function overrideKey(font, sizeStr) { return `print_cols_override_${font}_${sizeStr}`; }
function getColsOverride(font, sizeStr) {
  const k = overrideKey(font, sizeStr);
  try { return Number(localStorage.getItem(k)) || 0; } catch { return 0; }
}
function setColsOverride(font, sizeStr, delta) {
  const k = overrideKey(font, sizeStr);
  try { localStorage.setItem(k, String(Number(delta) || 0)); } catch {}
}

/* ===== In qua trình duyệt ===== */
function printViaBrowser({ text, copies = 1, fontPx = 12 }) {
  const repeat = Math.max(1, Number(copies) || 1);
  const ticket = (t) => `<div class="ticket"><pre class="pre">${t.replace(/</g, "&lt;")}</pre></div>`;
  const html = `<!doctype html><html><head><meta charset="utf-8">
    <title>Print</title>
    <style>
      @page { size: 58mm auto; margin:0; }
      html,body{ padding:0; margin:0; }
      .ticket{ width:58mm; margin:0; padding:0; }
      .ticket + .ticket{ page-break-before:always; }
      .pre{ white-space:pre; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size:${Math.max(10, Number(fontPx) || 12)}px; line-height:1.35;
            -webkit-print-color-adjust:exact; print-color-adjust:exact; }
    </style>
  </head><body>${new Array(repeat).fill(ticket(text)).join("")}</body></html>`;

  const iframe = document.createElement("iframe");
  Object.assign(iframe.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open(); doc.write(html); doc.close();
  setTimeout(() => {
    iframe.contentWindow.focus();
    iframe.contentWindow.print();
    setTimeout(() => document.body.removeChild(iframe), 500);
  }, 100);
}

/* ===== QR helpers (decode từ ảnh + render preview) ===== */
async function pickQrImageFromGallery() {
  return new Promise((resolve) => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = "image/*";
    inp.style.display = "none";
    document.body.appendChild(inp);
    inp.onchange = () => {
      const f = inp.files?.[0] || null;
      document.body.removeChild(inp);
      resolve(f);
    };
    inp.click();
  });
}

async function fileToImageData(file, { maxWidth = 900 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res(true);
      img.onerror = (e) => rej(e);
      img.src = url;
    });

    const scale = Math.min(1, maxWidth / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function decodeQrFromFile(file) {
  let jsQR;
  try {
    const mod = await import("jsqr");
    jsQR = mod?.default;
  } catch {
    alert('Chưa cài thư viện đọc QR. Chạy: npm i jsqr');
    return null;
  }

  try {
    const imgData = await fileToImageData(file, { maxWidth: 900 });
    const code = jsQR(imgData.data, imgData.width, imgData.height, { inversionAttempts: "attemptBoth" });
    return code?.data || null;
  } catch {
    return null;
  }
}

async function renderQrToImg(imgEl, payload) {
  const text = String(payload || "").trim();
  if (!imgEl) return;
  if (!text) {
    imgEl.src = "";
    imgEl.style.display = "none";
    return;
  }
  let QRCode;
  try {
    const mod = await import("qrcode");
    QRCode = mod?.default || mod;
  } catch {
    alert('Chưa cài thư viện tạo QR preview. Chạy: npm i qrcode');
    imgEl.src = "";
    imgEl.style.display = "none";
    return;
  }
  try {
    const url = await QRCode.toDataURL(text, { margin: 1, scale: 6 });
    imgEl.src = url;
    imgEl.style.display = "block";
  } catch {
    imgEl.src = "";
    imgEl.style.display = "none";
  }
}

/* ===== Modal preview ===== */
export function openReceiptPreview({ shop, resident, bill }) {
  ensurePreviewStyles();

  const data = buildReceiptData({ shop, resident, bill });
  const tpl = loadTemplate();

  const advRaw = Math.max(
    0,
    Number(
      (bill && (bill.advance ?? bill.tamUng ?? bill.paidPartial)) ??
      (resident && (resident.advance ?? resident.tamUng ?? resident.paidPartial)) ?? 0
    ) || 0
  );

  const buildPreviewText = (cols) => {
    let txt = renderPreview(tpl, data, cols);
    const hasTamUng = /^\s*Tam\s*ung\s*\|/mi.test(txt);
    const hasConThieu = /^\s*Con\s*thieu\s*\|/mi.test(txt);

    if (advRaw > 0) {
      if (!hasTamUng || !hasConThieu) {
        const extra = renderPreview(`Tam ung|{{TAM_UNG}}\nCon thieu|{{CON_THIEU}}`, data, cols);
        const reTong = /^.*\bTong\s*\|.*$/m;
        txt = reTong.test(txt) ? txt.replace(reTong, (line) => `${line}\n${extra}`) : txt + "\n" + extra;
      }
    } else {
      txt = txt.replace(/^\s*Tam\s*ung\s*\|.*\n?/gmi, "").replace(/^\s*Con\s*thieu\s*\|.*\n?/gmi, "");
    }
    return txt;
  };

  const initCols = getNum(K.COLS, DEFAULTS.COLS);
  const initFontPx = getNum(K.FONT, DEFAULTS.FONT);
  const initCopies = getNum(K.COPIES, DEFAULTS.COPIES);

  const initQrOn = getBool(K.QR_ON, false);
  const initQrPayload = getStr(K.QR_PAYLOAD, "");
  const initQrSize = getNum(K.QR_SIZE, 7);
  const initQrEcc = getStr(K.QR_ECC, "M");

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="preview-backdrop"></div>
    <div class="preview-modal card" role="dialog" aria-modal="true">
      <h2>Xem trước biên lai (58mm)</h2>
      <div class="pv-body">
        <div id="apk-size" style="display:none">
          <label class="label">Kiểu chữ (APK)</label>
          <div class="form-grid">
            <select id="pv-apk-size" class="input">
              <option value="1x1">Thường (1×1)</option>
              <option value="2x1">Rộng ×2 (2×1)</option>
              <option value="1x2">Cao ×2 (1×2)</option>
              <option value="2x2">Rộng ×2, Cao ×2</option>
            </select>
            <select id="pv-apk-font" class="input">
              <option value="A">Font A (≈32 cột)</option>
              <option value="B">Font B (≈42 cột)</option>
            </select>
          </div>
          <div class="kv-row" style="margin-top:8px">
            <label class="label" style="display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="pv-lock-cols" checked>
              Khóa số cột theo Font/Size (khuyến nghị)
            </label>
            <span class="muted">Bật: số cột tự đổi theo Font + Rộng×Cao. Tắt: bạn tự chỉnh tay.</span>
          </div>
          <div class="form-grid" style="margin-top:6px">
            <div>
              <label class="label">Tinh chỉnh (± cột)</label>
              <input id="pv-cols-tweak" class="input" type="number" min="-6" max="6" step="1" value="0">
              <div class="helper">Lưu riêng theo từng combo (Font + Rộng×Cao).</div>
            </div>
          </div>
        </div>

        <div class="form-grid" style="margin:8px 0">
          <div>
            <label class="label">Khổ giấy (cột)</label>
            <input id="pv-cols" class="input" type="number" min="20" max="48" step="1" value="${initCols}">
            <div class="helper">Ở APK, nên bật “Khóa theo Font/Size”.</div>
          </div>
          <div>
            <label class="label">Số bản</label>
            <input id="pv-copies" class="input" type="number" min="1" max="10" step="1" value="${initCopies}">
          </div>
          <div>
            <label class="label">Cỡ chữ (px) – web</label>
            <input id="pv-font" class="input" type="number" min="10" max="22" step="1" value="${initFontPx}">
            <div class="helper">Web print chỉ tham khảo. APK dùng Font A/B + Size.</div>
          </div>
        </div>

        <!-- ===== QR UI ===== -->
        <div class="qr-box">
          <div class="qr-row">
            <label class="label" style="display:flex;align-items:center;gap:8px;margin:0;">
              <input type="checkbox" id="pv-qr-on" ${initQrOn ? "checked" : ""}>
              In kèm QR ngân hàng
            </label>

            <button class="btn ghost" id="pv-qr-pick" type="button">Chọn QR từ thư viện</button>

            <label class="label" style="margin:0;">Size</label>
            <input id="pv-qr-size" class="input" style="width:90px" type="number" min="1" max="16" step="1" value="${initQrSize}">

            <label class="label" style="margin:0;">ECC</label>
            <select id="pv-qr-ecc" class="input" style="width:90px">
              <option value="L" ${initQrEcc==="L"?"selected":""}>L</option>
              <option value="M" ${initQrEcc==="M"?"selected":""}>M</option>
              <option value="Q" ${initQrEcc==="Q"?"selected":""}>Q</option>
              <option value="H" ${initQrEcc==="H"?"selected":""}>H</option>
            </select>
          </div>

          <div class="form-grid" style="margin-top:8px">
            <div>
              <label class="label">Nội dung QR (có thể sửa trực tiếp)</label>
              <textarea id="pv-qr-payload" class="input qr-text" placeholder="VD: VietQR / URL / text...">${esc(initQrPayload || "")}</textarea>
              <div class="muted">Nếu chọn từ thư viện: app sẽ đọc QR -> đổ vào ô này. Lần sau in không cần chọn lại.</div>
            </div>
            <div style="display:flex;align-items:flex-start;justify-content:center;">
              <img id="pv-qr-img" class="qr-img" alt="QR preview"/>
            </div>
          </div>
        </div>

        <label class="label" style="margin-top:10px">Preview (mono)</label>
        <pre id="pv-out" class="mono-preview"></pre>

        <div class="toolbar pv-actions">
          <button id="pv-print-web" class="btn">In trình duyệt</button>
          <button id="pv-print-bt" class="btn" style="display:none">In Bluetooth (APK)</button>
          <button id="pv-close" class="btn ghost">Đóng</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const root = document.documentElement;
  const prevOverflow = root.style.overflow;
  root.style.overflow = "hidden";

  const $ = (s) => wrap.querySelector(s);
  const outEl = $("#pv-out");
  const colsEl = $("#pv-cols");
  const copiesEl = $("#pv-copies");
  const fontPxEl = $("#pv-font");
  const btnBT = $("#pv-print-bt");
  const btnWeb = $("#pv-print-web");
  const apkBox = $("#apk-size");
  const lockColsEl = $("#pv-lock-cols");
  const tweakEl = $("#pv-cols-tweak");

  // QR elements
  const qrOnEl = $("#pv-qr-on");
  const qrPickEl = $("#pv-qr-pick");
  const qrPayloadEl = $("#pv-qr-payload");
  const qrImgEl = $("#pv-qr-img");
  const qrSizeEl = $("#pv-qr-size");
  const qrEccEl = $("#pv-qr-ecc");

  const apkSizeEl = () => document.getElementById("pv-apk-size");
  const apkFontEl = () => document.getElementById("pv-apk-font");
  const sizeStr = () => apkSizeEl()?.value || "1x1";
  const fontAB = () => apkFontEl()?.value || "A";

  const effectiveCols = (font, size) => {
    const base = BASE_COLS[font] || 32;
    const [wStr] = String(size || "1x1").split("x");
    const w = Math.max(1, Number(wStr) || 1);
    return Math.floor(base / w);
  };

  const loadTweak = () => getColsOverride(fontAB(), sizeStr());
  const saveTweak = () => setColsOverride(fontAB(), sizeStr(), Number(tweakEl.value) || 0);

  const rerender = () => {
    const cols = Number(colsEl.value) || DEFAULTS.COLS;
    outEl.textContent = buildPreviewText(cols);

    const on = !!qrOnEl.checked;
    const payload = String(qrPayloadEl.value || "").trim();
    const show = on && !!payload;
    renderQrToImg(qrImgEl, show ? payload : "");
  };

  // persist & render (web common)
  colsEl.addEventListener("input", () => { setNum(K.COLS, colsEl.value); rerender(); });
  copiesEl.addEventListener("input", () => { setNum(K.COPIES, copiesEl.value); });
  fontPxEl.addEventListener("input", () => { setNum(K.FONT, fontPxEl.value); rerender(); });

  // QR persist + rerender
  qrOnEl.addEventListener("change", () => { setBool(K.QR_ON, qrOnEl.checked); rerender(); });
  qrPayloadEl.addEventListener("input", () => { setStr(K.QR_PAYLOAD, qrPayloadEl.value); rerender(); });
  qrSizeEl.addEventListener("input", () => { setNum(K.QR_SIZE, qrSizeEl.value); });
  qrEccEl.addEventListener("change", () => { setStr(K.QR_ECC, qrEccEl.value); });

  qrPickEl.addEventListener("click", async () => {
    const f = await pickQrImageFromGallery();
    if (!f) return;
    const payload = await decodeQrFromFile(f);
    if (!payload) {
      alert("Khong doc duoc QR tu anh. Hay chon anh QR ro net, vuong, nen trang.");
      return;
    }
    qrPayloadEl.value = payload;
    setStr(K.QR_PAYLOAD, payload);
    if (!qrOnEl.checked) {
      qrOnEl.checked = true;
      setBool(K.QR_ON, true);
    }
    rerender();
  });

  rerender();

  // In web
  btnWeb.onclick = () => {
    const cols = Number(colsEl.value) || DEFAULTS.COLS;
    const copies = Number(copiesEl.value) || DEFAULTS.COPIES;
    const fontPx = Number(fontPxEl.value) || DEFAULTS.FONT;
    const text = buildPreviewText(cols);
    printViaBrowser({ text, copies, fontPx });
  };

  // APK logic: auto-sync cols theo Font/Size + tweak
  if (isNative()) {
    if (apkBox) apkBox.style.display = "block";
    btnBT.style.display = "inline-flex";
    btnWeb.style.display = "none";

    tweakEl.value = String(loadTweak());

    const applyAutoCols = () => {
      if (!lockColsEl.checked) return;
      const base = effectiveCols(fontAB(), sizeStr());
      const tweak = Number(tweakEl.value) || 0;
      const next = Math.max(20, Math.min(48, base + tweak));
      if (Number(colsEl.value) !== next) {
        colsEl.value = String(next);
        setNum(K.COLS, next);
        rerender();
      }
    };

    apkFontEl()?.addEventListener("change", () => {
      tweakEl.value = String(loadTweak());
      applyAutoCols();
    });
    apkSizeEl()?.addEventListener("change", () => {
      tweakEl.value = String(loadTweak());
      applyAutoCols();
    });
    lockColsEl?.addEventListener("change", () => applyAutoCols());
    tweakEl?.addEventListener("input", () => { saveTweak(); applyAutoCols(); });

    applyAutoCols();

    // In Bluetooth (APK) — QR lấy từ preview (localStorage/UI), KHÔNG chọn lại mỗi lần
    btnBT.onclick = async () => {
      const [wStr, hStr] = sizeStr().split("x");
      const sizeOpt = { w: Math.max(1, Number(wStr) || 1), h: Math.max(1, Number(hStr) || 1) };

      const printQr = !!qrOnEl.checked;
      const qrPayload = String(qrPayloadEl.value || "").trim();
      const qrSize = Math.max(1, Math.min(16, Number(qrSizeEl.value) || 7));
      const qrEcc = String(qrEccEl.value || "M").toUpperCase();

      const ok = await printReceiptWithOptions({
        data,
        cols: Number(colsEl.value) || DEFAULTS.COLS,
        copies: Number(copiesEl.value) || DEFAULTS.COPIES,
        templateOpts: { font: fontAB(), size: sizeOpt },
        printQr,
        qrPayload,
        qrSize,
        qrEcc,
      });

      if (ok) closeModal();
    };
  }

  // Đóng
  $("#pv-close").onclick = () => closeModal();
  wrap.querySelector(".preview-backdrop").onclick = () => closeModal();
  document.addEventListener("keydown", onEsc);

  function onEsc(e) { if (e.key === "Escape") closeModal(); }
  function closeModal() {
    document.removeEventListener("keydown", onEsc);
    root.style.overflow = prevOverflow || "";
    document.body.removeChild(wrap);
  }
}
