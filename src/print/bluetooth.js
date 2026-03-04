// src/print/bluetooth.js
const KEY = "printer-address";

function bt() {
  return typeof window !== "undefined" ? window.bluetoothSerial : null;
}

/** Quyền Android 12+ (và FINE_LOCATION cho Android 10–11) */
async function requestRuntimePerms() {
  const perms = window.cordova?.plugins?.permissions;
  if (!perms) return;

  const REQS = [
    "android.permission.BLUETOOTH_CONNECT",
    "android.permission.BLUETOOTH_SCAN",
    "android.permission.ACCESS_FINE_LOCATION", // phòng hờ máy cũ
  ];

  await new Promise((resolve, reject) => {
    perms.requestPermissions(REQS, () => resolve(true), (e) => reject(e));
  });
}

/** Đảm bảo có quyền + API plugin đã cấp quyền nội bộ */
async function ensurePermission() {
  const b = bt();
  if (!b) throw new Error("Bluetooth plugin chua san sang (chi chay trong APK).");

  // 1) Xin quyền runtime (Android 12+)
  try { await requestRuntimePerms(); } catch {}

  // 2) Gọi API permission của bluetooth-serial (nếu có)
  await new Promise((res) =>
    b.hasPermission?.((ok) => {
      if (ok) return res(true);
      b.requestPermission?.(() => res(true), () => res(true));
    }) ?? res(true)
  );
}

/** Bật Bluetooth nếu đang tắt */
async function ensureEnabled() {
  const b = bt(); if (!b) throw new Error("Bluetooth plugin not available");
  await new Promise((res, rej) =>
    b.isEnabled(res, () => b.enable(res, rej))
  );
}

/** timeout helper cho promise-based plugin calls */
function withTimeout(promise, ms, msg = "Timeout") {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(msg)), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); })
           .catch((e) => { clearTimeout(t); reject(e); });
  });
}

export async function listPaired() {
  await ensurePermission();
  await ensureEnabled();
  const b = bt();

  // Nếu thiếu CONNECT sẽ ném lỗi -> thử xin quyền lại một lần
  try {
    return await withTimeout(new Promise((res, rej) => b.list(res, rej)), 8000, "list timeout");
  } catch (e) {
    try {
      await requestRuntimePerms();
      return await withTimeout(new Promise((res, rej) => b.list(res, rej)), 8000, "list timeout");
    } catch (ee) {
      throw ee;
    }
  }
}

export async function isConnected() {
  const b = bt(); if (!b) return false;
  return await new Promise((res) => b.isConnected(() => res(true), () => res(false)));
}

export async function connect(id) {
  await ensurePermission();
  await ensureEnabled();
  const b = bt();
  await withTimeout(new Promise((res, rej) => b.connect(id, res, rej)), 10000, "connect timeout");
  try { localStorage.setItem(KEY, id); } catch {}
}

export function getSavedId() {
  try { return localStorage.getItem(KEY) || null; } catch { return null; }
}

/** Ghi theo chunk với timeout để tránh treo plugin */
export async function writeRaw(bytes) {
  const b = bt(); if (!b) throw new Error("Bluetooth plugin not available");
  const CHUNK = 256;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const part = bytes.slice(i, i + CHUNK);
    await withTimeout(new Promise((res, rej) => b.write(part, res, rej)), 8000, "write timeout");
  }
}

/** Modal chọn thiết bị — tự kèm style tối thiểu để không phụ thuộc preview.css */
function pickDeviceModal(devices) {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <style>
        .bt-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:1000;}
        .bt-modal{position:fixed;z-index:1001;top:50%;left:50%;transform:translate(-50%,-50%);
                  width:min(92vw,560px);max-height:min(92vh,600px);overflow:auto;}
        .bt-card{background:var(--card-bg,#111827);color:#e5e7eb;border-radius:14px;padding:16px;
                 border:1px solid rgba(148,163,184,.25);}
        .bt-toolbar{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;}
        .bt-list{display:flex;flex-direction:column;gap:8px;margin-top:10px;}
        .bt-item{display:flex;gap:10px;align-items:center;padding:10px;border-radius:12px;
                 border:1px solid rgba(148,163,184,.25);background:rgba(148,163,184,.06);cursor:pointer;}
        .bt-item:hover{background:rgba(148,163,184,.1);}
        .bt-item .name{font-weight:800;}
        .bt-item .id{opacity:.8;font-size:12px;}
      </style>
      <div class="bt-backdrop"></div>
      <div class="bt-modal">
        <div class="bt-card">
          <h2>Chọn máy in Bluetooth</h2>
          <div class="bt-list"></div>
          <div class="bt-toolbar">
            <button id="dp-cancel" class="btn ghost">Hủy</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const list = wrap.querySelector(".bt-list");
    list.innerHTML = (devices||[]).map(d => `
      <button class="bt-item" data-id="${d.id}">
        <div class="name">${d.name || "Printer"}</div>
        <div class="id">${d.id}</div>
      </button>`).join("");

    const onClick = (e) => {
      const btn = e.target.closest(".bt-item"); if (!btn) return;
      const dev = devices.find(x => x.id === btn.dataset.id);
      cleanup(); resolve(dev || null);
    };
    list.addEventListener("click", onClick);
    wrap.querySelector("#dp-cancel").onclick = () => { cleanup(); resolve(null); };

    function cleanup(){ document.body.removeChild(wrap); }
  });
}

/** Kết nối nếu cần: ưu tiên id đã lưu; nếu không có -> hiện modal chọn */
export async function ensureConnectedInteractive() {
  try {
    if (!bt()) { alert("Chức năng in Bluetooth chỉ hoạt động trong APK."); return false; }
    await ensurePermission();
    await ensureEnabled();

    if (await isConnected()) return true;

    const saved = getSavedId();
    if (saved) {
      try { await connect(saved); return true; } catch {}
    }

    const paired = await listPaired();
    if (!paired?.length) {
      alert("Chưa thấy máy in nào trong danh sách đã ghép đôi.\nHãy vào Cài đặt Bluetooth để ghép đôi trước (PIN 0000).");
      return false;
    }
    const prefer = paired.find(p => /aibecy|pos|printer|escpos/i.test(p.name || "")) || null;
    const dev = prefer || (await pickDeviceModal(paired));
    if (!dev) return false;

    await connect(dev.id);
    return true;
  } catch (e) {
    alert("Không thể kết nối máy in: " + (e?.message || e));
    return false;
  }
}
