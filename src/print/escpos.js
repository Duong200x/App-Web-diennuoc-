// src/print/escpos.js
const ESC = "\x1B";
const GS  = "\x1D";

export let COLS = 32;
export function setCols(n){
  COLS = Math.max(16, Math.min(48, Number(n)||32));
}

export function noAccent(s=""){
  return (s||"")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[đĐ]/g, m => m==="đ" ? "d" : "D");
}

/**
 * Căn trái–phải theo width:
 * - Nếu l + r dài hơn width → cắt vế trái với dấu …
 * - Ưu tiên giữ nguyên vế phải (thường là số tiền)
 */
export function leftRight(l="", r="", width=COLS){
  l = noAccent(String(l));
  r = noAccent(String(r));
  width = Math.max(16, Math.min(48, Number(width)||COLS));

  // nếu r quá dài, cắt r và ưu tiên giữ cuối (số tiền)
  if (r.length > width) {
    r = r.slice(-width);
  }

  const maxLeft = Math.max(0, width - r.length - 1); // tối đa cho vế trái, chừa 1 space
  if (l.length > maxLeft) {
    if (maxLeft <= 1) {
      l = ""; // không còn chỗ
    } else if (maxLeft === 2) {
      l = "…"; // tối thiểu báo hiệu
    } else {
      l = l.slice(0, maxLeft - 1) + "…";
    }
  }

  const sp = Math.max(1, width - l.length - r.length);
  return l + " ".repeat(sp) + r;
}

export const hr = (ch="-", width=COLS) => {
  width = Math.max(16, Math.min(48, Number(width)||COLS));
  return new Array(width).fill(ch).join("");
};

// ====== KHỞI TẠO + CĂN LỀ ======
export function init(opts={}) {
  const left  = Math.max(0, Math.min(65535, (opts.left ?? 0)|0)); // dot
  const line  = Math.max(16, Math.min(64,    (opts.line ?? 30)|0));
  const lL = left & 0xff, lH = (left>>8)&0xff;
  return "\x1B@"                 // ESC @ reset
       + "\x1Ba\x00"             // align left
       + "\x1D\x4C" + String.fromCharCode(lL,lH) // GS L left margin
       + "\x1B\x33" + String.fromCharCode(line); // ESC 3 n line spacing
}

// ====== CHỮ ĐẬM / KÍCH THƯỚC / FONT ======
export const aL = () => ESC+"a"+"\x00";
export const aC = () => ESC+"a"+"\x01";
export const aR = () => ESC+"a"+"\x02";

export const bOn  = () => ESC+"E"+"\x01";
export const bOff = () => ESC+"E"+"\x00";

// Kích thước “double” tiêu chuẩn (cả rộng + cao)
export const dOn  = () => GS+"!"+"\x11";
export const dOff = () => GS+"!"+"\x00";

// Font ESC/POS
export const fontA = () => ESC+"M"+"\x00"; // A: 12x24 → ~32 cột trên 58mm
export const fontB = () => ESC+"M"+"\x01"; // B:  9x17 → ~42 cột trên 58mm

// size(w,h): w,h = 1..8 (1 = bình thường; 2 = gấp đôi; ...)
export function size(w=1,h=1){
  w = Math.max(1,Math.min(8, w))|0;
  h = Math.max(1,Math.min(8, h))|0;
  const n = ((w-1)<<4) | (h-1);
  return GS+"!"+String.fromCharCode(n);
}

export const feed = (n=2) => ESC+"d"+String.fromCharCode(n);

/**
 * Chuyển chuỗi sang bytes (Latin-1 best effort)
 * ESC/POS thường là 8-bit; ta đã noAccent() trước đó.
 */
export function toBytes(str){
  const s = String(str ?? "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    out[i] = (code <= 0xFF) ? code : 0x3F; // '?' cho ký tự ngoài phạm vi
  }
  return out;
}
// ====== QR (ESC/POS: GS ( k) ======
export function qrBytes(content, { size = 7, ecc = "M", model = 2 } = {}) {
  const txt = noAccent(String(content ?? ""));
  const data = toBytes(txt);

  const toEcc = (x) => {
    const m = String(x || "M").toUpperCase();
    if (m === "L") return 48;
    if (m === "M") return 49;
    if (m === "Q") return 50;
    if (m === "H") return 51;
    return 49;
  };

  const gs_k = (cn, fn, payloadBytes) => {
    const len = (payloadBytes?.length || 0) + 2;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    const head = Uint8Array.from([0x1D, 0x28, 0x6B, pL, pH, cn, fn]);
    return payloadBytes ? concatBytes(head, payloadBytes) : head;
  };

  const m = model === 1 ? 49 : 50; // 49: model 1, 50: model 2
  const sz = Math.max(1, Math.min(16, Number(size) || 7));

  // Select model
  const c1 = gs_k(0x31, 0x41, Uint8Array.from([m, 0x00]));
  // Set size
  const c2 = gs_k(0x31, 0x43, Uint8Array.from([sz]));
  // Set ECC
  const c3 = gs_k(0x31, 0x45, Uint8Array.from([toEcc(ecc)]));
  // Store data (prefix 0x30)
  const c4 = gs_k(0x31, 0x50, concatBytes(Uint8Array.from([0x30]), data));
  // Print (0x30)
  const c5 = gs_k(0x31, 0x51, Uint8Array.from([0x30]));

  return concatMany([c1, c2, c3, c4, c5]);
}

function concatBytes(a, b) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function concatMany(arrs) {
  const total = arrs.reduce((s, a) => s + (a?.length || 0), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}
