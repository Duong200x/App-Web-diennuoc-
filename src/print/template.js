// src/print/template.js  (BẢN ĐÃ FIX THEO YÊU CẦU)
import {
  init, aL, aC, aR, bOn, bOff, dOn, dOff, leftRight, feed,
  noAccent, fontA, fontB, size
} from "./escpos.js";
import { getStr, setStr, KEYS } from "../state/storage.js";

const LOCAL_FALLBACK_KEY = "receipt-template-v1";

export const DEFAULT_TEMPLATE =
`@C @B @D {{SHOP_NAME}} @/D @/B
@C {{SHOP_ADDR}}
@C DT: {{SHOP_PHONE}}
@HR
@C @B {{TITLE}} @/B
@C {{THANG}}
@HR
Ten: {{TEN}}
Dia chi: {{DIA_CHI}}
Ngay: {{NGAY}}
@HR
Dien cu|{{DIEN_CU}}
Dien moi|{{DIEN_MOI}}
Nuoc cu|{{NUOC_CU}}
Nuoc moi|{{NUOC_MOI}}
So kWh|{{KWH}}
So m3|{{M3}}
@HR
Tien dien|{{TIEN_DIEN}}
Tien nuoc|{{TIEN_NUOC}}
Khoan no|{{KHOAN_NO}}
Tam ung|{{TAM_UNG}}
Tong|{{TONG}}
@HR2
@C Cam on quy khach!
VUI LONG THANH TOAN 
TRONG 1 TUAN QUA HAN
SE BI CAT DIEN NUOC 
`;

/* ===================== helpers ===================== */
const toNumber = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d\.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const money = (n) => Number(n || 0).toLocaleString("vi-VN");

// chỉ đọc nợ/tạm ứng từ data (không tự tính)
const readDebtOnly = (data) => {
  const keys = ["NO_KY_TRUOC", "KHOAN_NO", "NO", "DEBT", "DEBT_AMOUNT"];
  for (const k of keys) {
    const v = toNumber(data?.[k]);
    if (v) return v;
  }
  return 0;
};
const readAdvanceOnly = (data) => {
  const keys = [
    "TAM_UNG","tamUng","tam_ung","advance","prepaid","prepay",
    "deposit","partial","partialPaid","paidAmount","advancePaid","ADVANCE_RAW"
  ];
  for (const k of keys) {
    const v = toNumber(data?.[k]);
    if (v) return v;
  }
  return 0;
};
const readRemainOnly = (data) => {
  // Ưu tiên số thô nếu có
  const raw = toNumber(data?.REMAIN_RAW);
  if (raw) return raw;
  // Thử parse từ CON_THIEU (định dạng tiền)
  const parsed = toNumber(data?.CON_THIEU);
  return parsed || 0;
};

function lineHasDebtToken(l) {
  const s = noAccent(l).toLowerCase();
  return s.includes("khoan no") || /\{\{(no_ky_truoc|khoan_no|no|debt)\}\}/i.test(l);
}
function lineHasAdvanceToken(l) {
  const s = noAccent(l).toLowerCase();
  return s.includes("tam ung") || /\{\{(tam_ung|advance|prepaid|prepay|deposit)\}\}/i.test(l);
}
function lineHasRemainToken(l) {
  const s = noAccent(l).toLowerCase();
  return s.includes("con thieu") || /\{\{(con_thieu|remain|remaining)\}\}/i.test(l);
}
function templateHasDebtLine(tpl)    { return tpl.split(/\r?\n/).some(lineHasDebtToken); }
function templateHasAdvanceLine(tpl) { return tpl.split(/\r?\n/).some(lineHasAdvanceToken); }
function templateHasRemainLine(tpl)  { return tpl.split(/\r?\n/).some(lineHasRemainToken); }

// map token nhanh
const replaceTokens = (s, data) =>
  String(s ?? "").replace(/\{\{(\w+)\}\}/g, (_, k) => (data?.[k] ?? "") + "");

/* ===================== storage ===================== */
export function loadTemplate(){
  // Ưu tiên khóa đúng cho template 58mm
  try {
    const vNew = getStr?.(KEYS.tpl58, "");
    if (vNew && vNew.trim()) return vNew;
  } catch {}
  // Fallback tương thích cũ: nếu trước đây lỡ lưu nhầm vào template Word
  try {
    const vOld = getStr?.(KEYS.tpl, "");
    if (vOld && vOld.trim()) return vOld;
  } catch {}
  // Fallback localStorage
  try {
    const v2 = localStorage.getItem(LOCAL_FALLBACK_KEY) || "";
    return v2.trim() ? v2 : DEFAULT_TEMPLATE;
  } catch {}
  return DEFAULT_TEMPLATE;
}

export function saveTemplate(t){
  const val = String(t || "");
  try { setStr?.(KEYS.tpl58, val); return; } catch {}
  try { localStorage.setItem(LOCAL_FALLBACK_KEY, val); } catch {}
}

/* ===================== render (ESC/POS – in thật) ===================== */
/**
 * renderTemplate(template, data, opts)
 * opts: { cols?:number, font?:"A"|"B", size?:{w:number,h:number} }
 * - Tự chỉnh cols theo font: A→32, B→42 (để tránh hẹp/quá rộng).
 * - Chèn động Tam ứng, Còn thiếu, Khoản nợ trước dòng "Tổng" nếu template thiếu.
 */
export function renderTemplate(template, data, opts = {}){
  const userCols = Number(opts.cols) || 32;
  const fontSel  = (opts.font || "A").toUpperCase();
  // Auto-fix “cột” theo font đã chọn để tránh lệch:
  let cols = userCols;
  if (fontSel === "B" && cols < 38) cols = 42;
  if (fontSel === "A" && cols > 40) cols = 32;

  const rep  = (s) => noAccent(replaceTokens(s, data));
  const line = (ch = "-") => new Array(cols).fill(ch).join("");

  const debt    = readDebtOnly(data);              // số thô
  const adv     = readAdvanceOnly(data);           // số thô
  const remain  = Math.max(readRemainOnly(data), 0); // số thô

  const debtText   = money(debt);
  const advText    = money(adv);
  const remainText = money(remain);

  let out = init({ left: 0, line: 30 });
  out += (fontSel === "B" ? fontB() : fontA());
  if (opts.size?.w || opts.size?.h) out += size(opts.size.w || 1, opts.size.h || 1);

  const push = (t) => { out += t + "\n"; };

  const needInjectDebt    = !templateHasDebtLine(template)    && debt > 0;
  const needInjectAdvance = !templateHasAdvanceLine(template) && adv > 0;
  const needInjectRemain  = !templateHasRemainLine(template)  && remain > 0;

  let debtInserted = false, advInserted = false, remainInserted = false;

  for (const raw of template.split(/\r?\n/)){
    const l = raw.trim();
    if (!l) continue;

    if (l.startsWith("@")){
      const toks = l.split(/\s+/); let text = [];
      for (const t of toks){
        if (t === "@C"){ out += aC(); continue; }
        if (t === "@L"){ out += aL(); continue; }
        if (t === "@R"){ out += aR(); continue; }
        if (t === "@B"){ out += bOn(); continue; }
        if (t === "@/B"){ out += bOff(); continue; }
        if (t === "@D"){ out += dOn(); continue; }
        if (t === "@/D"){ out += dOff(); continue; }
        if (t === "@FA"){ out += fontA(); continue; }
        if (t === "@FB"){ out += fontB(); continue; }
        if (t.startsWith("@SZ")){
          const m = t.match(/^@SZ(\d+)x(\d+)$/i);
          if (m) { out += size(+m[1], +m[2]); continue; }
        }
        if (t === "@HR"){ push(line("-")); continue; }
        if (t === "@HR2"){ push(line("=")); continue; }
        text.push(t);
      }
      const txt = rep(text.join(" "));
      if (txt) push(txt);
      continue;
    }

    const lr = l.split("|");
    if (lr.length === 2){
      const leftRaw  = rep(lr[0]);
      const rightRaw = rep(lr[1]);

      // Trước dòng "Tong": chèn Tam ứng / Còn thiếu / Khoản nợ nếu cần
      const isTong = /^tong\b/i.test(noAccent(leftRaw));
      if (isTong) {
        if (needInjectAdvance && !advInserted)  { push( leftRight("Tam ung",  advText,    cols) ); advInserted = true; }
        if (needInjectRemain  && !remainInserted){ push( leftRight("Con thieu", remainText, cols) ); remainInserted = true; }
        if (needInjectDebt    && !debtInserted) { push( leftRight("Khoan no", debtText,   cols) ); debtInserted = true; }
      }

      push( leftRight(leftRaw, rightRaw, cols) );
      continue;
    }

    push(rep(l));
  }

  // Nếu chưa chèn được trong vòng lặp (template không có 'Tổng')
  if (needInjectAdvance && !advInserted)  push( leftRight("Tam ung",  advText,    cols) );
  if (needInjectRemain  && !remainInserted) push( leftRight("Con thieu", remainText, cols) );
  if (needInjectDebt    && !debtInserted) push( leftRight("Khoan no", debtText,   cols) );

  out += feed(4);
  return out;
}

/* ===================== renderPreview (web) ===================== */
/**
 * renderPreview(template, data, cols)
 * - Không có ESC/POS, chỉ căn theo cols để xem trước.
 * - Không tự đổi cols theo font (người dùng chỉnh ở UI). Preview trung thành số cột đang chọn.
 * - Chèn động Tam ứng / Còn thiếu / Khoản nợ giống bản in thật.
 */
export function renderPreview(template, data, cols = 32){
  cols = Math.max(20, Math.min(48, Number(cols) || 32));

  const rep  = (s) => noAccent(replaceTokens(s, data));
  const line = (ch = "-") => new Array(cols).fill(ch).join("");

  const debt    = readDebtOnly(data);
  const adv     = readAdvanceOnly(data);
  const remain  = Math.max(readRemainOnly(data), 0);

  const debtText   = money(debt);
  const advText    = money(adv);
  const remainText = money(remain);

  const needInjectDebt    = !templateHasDebtLine(template)    && debt > 0;
  const needInjectAdvance = !templateHasAdvanceLine(template) && adv > 0;
  const needInjectRemain  = !templateHasRemainLine(template)  && remain > 0;

  let debtInserted = false, advInserted = false, remainInserted = false;

  let out = "", align = "L";
  const push = (t) => { out += t + "\n"; };

  for (const raw of template.split(/\r?\n/)) {
    let l = raw.trim();
    if (!l) continue;

    if (l.startsWith("@")){
      const toks = l.split(/\s+/); let text = [];
      for (const t of toks){
        if (t === "@C"){ align = "C"; continue; }
        if (t === "@L"){ align = "L"; continue; }
        if (t === "@R"){ align = "R"; continue; }
        if (t === "@HR"){ push(line("-")); continue; }
        if (t === "@HR2"){ push(line("=")); continue; }
        // In preview bỏ qua B/D/FA/FB/SZ…
        if (t === "@B" || t === "@/B" || t === "@D" || t === "@/D" || t === "@FA" || t === "@FB" || t.startsWith("@SZ")) continue;
        text.push(t);
      }
      const txt = rep(text.join(" "));
      if (txt){
        const len = txt.length;
        if (align === "C"){ const pad = Math.max(0, Math.floor((cols - len) / 2)); push(" ".repeat(pad) + txt); }
        else if (align === "R"){ const pad = Math.max(0, cols - len); push(" ".repeat(pad) + txt); }
        else { push(txt); }
      }
      continue;
    }

    const lr = l.split("|");
    if (lr.length === 2){
      const leftRaw  = rep(lr[0]);
      const rightRaw = rep(lr[1]);

      const isTong = /^tong\b/i.test(noAccent(leftRaw));
      if (isTong) {
        if (needInjectAdvance && !advInserted)   { push( leftRight("Tam ung",   advText,    cols) ); advInserted = true; }
        if (needInjectRemain  && !remainInserted){ push( leftRight("Con thieu", remainText, cols) ); remainInserted = true; }
        if (needInjectDebt    && !debtInserted)  { push( leftRight("Khoan no",  debtText,   cols) ); debtInserted = true; }
      }

      push( leftRight(leftRaw, rightRaw, cols) );
      continue;
    }

    const txt = rep(l);
    const len = txt.length;
    if (align === "C"){ const pad = Math.max(0, Math.floor((cols - len) / 2)); push(" ".repeat(pad) + txt); }
    else if (align === "R"){ const pad = Math.max(0, cols - len); push(" ".repeat(pad) + txt); }
    else { push(txt); }
  }

  if (needInjectAdvance && !advInserted)   push( leftRight("Tam ung",   advText,    cols) );
  if (needInjectRemain  && !remainInserted)push( leftRight("Con thieu", remainText, cols) );
  if (needInjectDebt    && !debtInserted)  push( leftRight("Khoan no",  debtText,   cols) );

  return out;
}
