// src/state/zones.js
export const ZONES = [
  { key: "tren", label: "Khu Trên" },
  { key: "duoi", label: "Khu Dưới" },
  { key: "giua", label: "Khu Giữa" },
  { key: "khac", label: "Khác" },
];

export function zoneLabel(key) {
  const z = ZONES.find(z => z.key === key);
  return z ? z.label : "Khác";
}
