export function getCurrentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Nhận Date hoặc chuỗi bất kỳ (ISO, "YYYY-MM-DD", ...)
export function fmtDMY(input) {
  if (!input) return "-";
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input); // fallback an toàn
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
export function monthYearLabel(date = new Date()) {
  const m = date.getMonth() + 1;
  const y = date.getFullYear();
  return `Tháng ${m} - ${y}`;
}
export function labelFromMonthKey(key) {
  if (!key) return "";
  const [y, m] = key.split("-");
  return `Tháng ${Number(m)} - ${y}`;
}
// Ngày 17 tháng 05 năm 2025
export function vnLongDate(iso) {
  if (!iso) return "";
  const [y, m, d] = iso.split("-");
  return `Ngày ${d} tháng ${m} năm ${y}`;
}
