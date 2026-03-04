// src/utils/normalize.js

/**
 * Bo dau tieng Viet, bo STT o dau, lowercase, trim.
 */
export const deaccent = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");

export const stripOrdinal = (s) => String(s || "").replace(/^\s*\d+[\.,-]?\s*/, "");

export const canon = (s) =>
  deaccent(stripOrdinal(s)).toLowerCase().replace(/\s+/g, " ").trim();

export const slug = (s) =>
  deaccent(String(s || "")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "id";

/**
 * Key duy nhất để khớp cư dân: "ten-da-slugged|dia-chi-da-slugged"
 */
export function residentKey(it) {
  const n = slug(it?.name || "");
  const a = slug(it?.address || it?.zone || "");
  return `${n}|${a}`;
}
