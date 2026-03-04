// src/state/storage.js
export const KEYS = {
  current: "currentReadings",
  history: "historyReadings",
  month:   "savedMonth",
  rateE:   "electricityRate",
  rateW:   "waterRate",
  tpl:     "wordTemplate",
  due:     "defaultDue",
  contact: "defaultContact",
  tpl58:   "tpl58",          // Mẫu biên lai ESC/POS (58mm)
  shop_name:  "shop_name",
  shop_addr:  "shop_addr",
  shop_phone: "shop_phone",
  roomId:     "roomId",
};

/* JSON */
export const getJSON = (k, def) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : def;
  } catch {
    return def;
  }
};
export const setJSON = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
};

/* Number (an toàn hơn Number(localStorage.getItem())) */
export const getNum = (k, def = 0) => {
  try {
    const raw = localStorage.getItem(k);
    if (raw == null) return def;
    const n = Number(String(raw).replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : def;
  } catch {
    return def;
  }
};
export const setNum = (k, v) => {
  try {
    const n = Number(v);
    localStorage.setItem(k, String(Number.isFinite(n) ? n : 0));
  } catch {}
};

/* String */
export const getStr = (k, def = "") => {
  try {
    const v = localStorage.getItem(k);
    return v == null ? def : String(v);
  } catch {
    return def;
  }
};
export const setStr = (k, v) => {
  try { localStorage.setItem(k, String(v ?? "")); } catch {}
};
