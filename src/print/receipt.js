// src/print/receipt.js
import { toBytes } from "./escpos.js";
import { renderTemplate, loadTemplate } from "./template.js";
import { ensureConnectedInteractive, writeRaw } from "./bluetooth.js";
import { money } from "../utils/format.js";

const toNum = (v) => {
  const n = Number(String(v ?? "").replace(/[^\d\.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

function noAccent(s = "") {
  return (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (m) => (m === "đ" ? "d" : "D"));
}

function concatMany(arrs) {
  const total = arrs.reduce((s, a) => s + (a?.length || 0), 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) {
    if (!a || !a.length) continue;
    out.set(a, off);
    off += a.length;
  }
  return out;
}

// ESC/POS QR: GS ( k
function qrBytes(content, { size = 7, ecc = "M", model = 2 } = {}) {
  const txt = noAccent(String(content ?? ""));
  const data = toBytes(txt);

  const eccByte = (() => {
    const m = String(ecc || "M").toUpperCase();
    if (m === "L") return 48;
    if (m === "M") return 49;
    if (m === "Q") return 50;
    if (m === "H") return 51;
    return 49;
  })();

  const gs_k = (cn, fn, payloadBytes) => {
    const len = (payloadBytes?.length || 0) + 2;
    const pL = len & 0xff;
    const pH = (len >> 8) & 0xff;
    const head = Uint8Array.from([0x1d, 0x28, 0x6b, pL, pH, cn, fn]);
    return payloadBytes ? concatMany([head, payloadBytes]) : head;
  };

  const m = model === 1 ? 49 : 50; // 49 model1, 50 model2
  const sz = Math.max(1, Math.min(16, Number(size) || 7));

  const c1 = gs_k(0x31, 0x41, Uint8Array.from([m, 0x00])); // select model
  const c2 = gs_k(0x31, 0x43, Uint8Array.from([sz]));      // set size
  const c3 = gs_k(0x31, 0x45, Uint8Array.from([eccByte])); // set ecc
  const c4 = gs_k(0x31, 0x50, concatMany([Uint8Array.from([0x30]), data])); // store
  const c5 = gs_k(0x31, 0x51, Uint8Array.from([0x30]));    // print

  return concatMany([c1, c2, c3, c4, c5]);
}

/** Chuẩn hoá dữ liệu cho template (KHÔNG tự tính trong template) */
export function buildReceiptData({ shop, resident, bill }) {
  const dSrc = bill?.date ?? Date.now();
  const d = dSrc instanceof Date ? dSrc : new Date(dSrc);
  const pad = (n) => String(n).padStart(2, "0");
  const ngay = Number.isNaN(d.getTime())
    ? "-"
    : `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;

  const elec = toNum(bill?.elec ?? 0);
  const water = toNum(bill?.water ?? 0);
  const debt = toNum(bill?.debt ?? bill?.prevDebt ?? resident?.prevDebt ?? 0);

  const advance = toNum(
    bill?.advance ??
      bill?.tamUng ??
      bill?.paidPartial ??
      bill?.daThu ??
      resident?.advance ??
      resident?.tamUng ??
      resident?.paidPartial ??
      resident?.daThu ??
      resident?.collected ??
      0
  );

  const total = bill?.total != null ? toNum(bill.total) : elec + water + debt;
  const remain = Math.max(total - advance, 0);

  return {
    SHOP_NAME: shop?.name || "DIEN NUOC",
    SHOP_ADDR: shop?.addr || "",
    SHOP_PHONE: shop?.phone || "",

    TITLE: "BIEN LAI THU TIEN",
    THANG: bill?.monthLabel || "",
    NGAY: ngay,

    TEN: resident?.name || "",
    DIA_CHI: resident?.address || "",

    DIEN_CU: bill?.dOld ?? "",
    DIEN_MOI: bill?.dNew ?? "",
    NUOC_CU: bill?.wOld ?? "",
    NUOC_MOI: bill?.wNew ?? "",
    KWH: bill?.kWh ?? "",
    M3: bill?.m3 ?? "",

    TIEN_DIEN: money(elec),
    TIEN_NUOC: money(water),
    TONG: money(total),

    NO_KY_TRUOC: debt,
    KHOAN_NO: debt,
    TAM_UNG: money(advance),
    CON_THIEU: money(remain),

    ADVANCE_RAW: advance,
    REMAIN_RAW: remain,
  };
}

/** Chuẩn hóa newline cho payload gửi máy in */
function normalizePrintText(s) {
  return String(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/**
 * In qua Bluetooth với tuỳ chọn
 * - printQr: bật/tắt in QR
 * - qrPayload: nội dung QR (đã lấy/đã đổi ở preview)
 */
export async function printReceiptWithOptions({
  data,
  cols = 32,
  copies = 1,
  template,
  templateOpts = {},
  printQr = false,
  qrPayload = "",
  qrSize = 7,
  qrEcc = "M",
}) {
  const connected = await ensureConnectedInteractive();
  if (!connected) return false;

  const tpl = template || loadTemplate();
  let raw = renderTemplate(tpl, data, { cols, ...templateOpts });

  // ===== Hiển thị động “Tam ung / Con thieu” ngay dưới “Tong” =====
  const hasTamUngInTpl = /^\s*Tam\s*ung\s*\|/mi.test(raw);
  const hasConThieuInTpl = /^\s*Con\s*thieu\s*\|/mi.test(raw);
  const adv = Number(data.ADVANCE_RAW || 0);

  if (adv > 0) {
    if (!hasTamUngInTpl && !hasConThieuInTpl) {
      const extraTpl = `Tam ung|{{TAM_UNG}}\nCon thieu|{{CON_THIEU}}`;
      const extra = renderTemplate(extraTpl, data, { cols, ...templateOpts });

      const reTong = /^.*\bTong\s*\|.*$/m;
      if (reTong.test(raw)) {
        raw = raw.replace(reTong, (line) => `${line}\n${extra}`);
      } else {
        const i = raw.lastIndexOf("@HR2");
        raw =
          i !== -1
            ? raw.slice(0, i) + extra + "\n" + raw.slice(i)
            : raw + "\n" + extra;
      }
    }
  } else {
    raw = raw
      .replace(/^\s*Tam\s*ung\s*\|.*\n?/gmi, "")
      .replace(/^\s*Con\s*thieu\s*\|.*\n?/gmi, "");
  }

  const tail = "\n\n\n";
  const payload = normalizePrintText(raw) + tail;

  // ===== QR (ESC/POS) — in sắc nét như self-test =====
  let qrPart = new Uint8Array();
  if (printQr && String(qrPayload || "").trim()) {
    qrPart = concatMany([
      toBytes("\n"),
      Uint8Array.from([0x1b, 0x61, 0x01]), // center
      toBytes(noAccent("QUET QR DE THANH TOAN") + "\n"),
      qrBytes(qrPayload, { size: qrSize, ecc: qrEcc, model: 2 }),
      toBytes("\n"),
      Uint8Array.from([0x1b, 0x61, 0x00]), // left
      toBytes("\n\n"),
    ]);
  }

  const allBytes = concatMany([toBytes(payload), qrPart]);

  const repeat = Math.max(1, Number(copies) || 1);
  for (let i = 0; i < repeat; i++) {
    await writeRaw(allBytes);
  }

  return true;
}

export async function printReceipt(data) {
  return printReceiptWithOptions({ data, cols: 32, copies: 1 });
}
