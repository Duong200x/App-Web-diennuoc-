// src/state/backup.js
import { getJSON, setJSON, getStr, KEYS } from "./storage.js";
import { saveTextSmart } from "../utils/save.js";

const SNAPSHOT_VERSION = 1;
const MAX_KEEP_DEFAULT = 3; // CHỈ GIỮ 3 BẢN

export function makeSnapshot() {
  return {
    _v: SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    month: localStorage.getItem(KEYS.month) || "",
    current: getJSON(KEYS.current, []),
    history: getJSON(KEYS.history, {}),

    // mặc định đúng với Config hiện tại
    electricityRate: Number(localStorage.getItem(KEYS.rateE) ?? 2800),
    waterRate: Number(localStorage.getItem(KEYS.rateW) ?? 10500),
    template: getStr(KEYS.tpl, ""),
    due: getStr(KEYS.due, ""),
    contact: getStr(KEYS.contact, ""),

    roomId: getStr(KEYS.roomId, ""),
    meta: {
      ua: typeof navigator !== "undefined" ? navigator.userAgent : "",
      origin: typeof location !== "undefined" ? location.origin : "",
      platform: typeof navigator !== "undefined" ? navigator.platform : "",
    },
  };
}

// YYYYMMDD_HHmmss
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export async function downloadBackup() {
  const snapshot = makeSnapshot();
  const name = `backup_diennuoc_${nowStamp()}.json`;
  const text = JSON.stringify(snapshot, null, 2);
  await saveTextSmart(text, "application/json", name);
}

export async function restoreFromJsonText(text) {
  const obj = JSON.parse(text);
  if (!obj || typeof obj !== "object") throw new Error("Tệp không hợp lệ");
  if (!("current" in obj) || !("history" in obj)) throw new Error("Thiếu dữ liệu bắt buộc");

  setJSON(KEYS.current, Array.isArray(obj.current) ? obj.current : []);
  setJSON(KEYS.history, obj.history || {});
  if ("month" in obj) localStorage.setItem(KEYS.month, obj.month || "");
  if ("electricityRate" in obj) localStorage.setItem(KEYS.rateE, String(obj.electricityRate));
  if ("waterRate" in obj) localStorage.setItem(KEYS.rateW, String(obj.waterRate));
  if ("template" in obj) localStorage.setItem(KEYS.tpl, obj.template || "");
  if ("due" in obj) localStorage.setItem(KEYS.due, obj.due || "");
  if ("contact" in obj) localStorage.setItem(KEYS.contact, obj.contact || "");
  if ("roomId" in obj) localStorage.setItem(KEYS.roomId, obj.roomId || "");
}

export function clearAllData() {
  [
    KEYS.current, KEYS.history, KEYS.month,
    KEYS.rateE, KEYS.rateW, KEYS.tpl, KEYS.due, KEYS.contact,
    KEYS.roomId,
  ].forEach(k => localStorage.removeItem(k));
}

// ==== Auto-backup xoay vòng LocalStorage (GIỮ 3 BẢN) ====
const BK_PREFIX = "BACKUP_HISTORY_";
const BK_INDEX  = "BACKUP_INDEX";
const BK_LATEST = "BACKUP_LATEST";

function _readIndex() {
  try { return JSON.parse(localStorage.getItem(BK_INDEX) || "[]"); }
  catch { return []; }
}
function _writeIndex(arr) {
  localStorage.setItem(BK_INDEX, JSON.stringify(arr));
  // phát sự kiện để UI cập nhật
  try { window.dispatchEvent(new CustomEvent("backup:index-changed")); } catch {}
}

/**
 * Tạo snapshot và lưu vào LocalStorage (xoay vòng).
 * - maxKeep: số bản giữ lại (mặc định 3).
 * Trả về { key, at, roomId } hoặc null nếu lỗi.
 */
export function saveBackupLocal(maxKeep = MAX_KEEP_DEFAULT) {
  try {
    const keep = Math.max(1, Number(maxKeep) || MAX_KEEP_DEFAULT);
    const snap = makeSnapshot();
    const key = `${BK_PREFIX}${nowStamp()}`;

    localStorage.setItem(key, JSON.stringify(snap));
    localStorage.setItem(BK_LATEST, key);

    const idx = _readIndex().filter(k => !!localStorage.getItem(k));
    idx.unshift(key);
    while (idx.length > keep) {
      const oldKey = idx.pop();
      try { localStorage.removeItem(oldKey); } catch {}
    }
    _writeIndex(idx);

    return { key, at: snap.createdAt, roomId: snap.roomId ?? "" };
  } catch (e) {
    console.warn("[backup] saveBackupLocal failed:", e?.message || e);
    return null;
  }
}

export function listBackupsLocal() { return _readIndex(); }
export function readBackupLocal(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function readLatestBackupLocal() {
  const key = localStorage.getItem(BK_LATEST);
  return key ? readBackupLocal(key) : null;
}
export async function restoreBackupLocal(key) {
  const snap = readBackupLocal(key);
  if (!snap) throw new Error("Không tìm thấy bản sao lưu.");
  await restoreFromJsonText(JSON.stringify(snap));
  return { ok: true, at: snap.createdAt, roomId: snap.roomId ?? "" };
}
