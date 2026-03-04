// Chỉ cho số nguyên dương (>=0). Tự lọc khi paste / gõ sai.
export function enforceIntegerInput(input) {
  if (!input) return;
  input.setAttribute("inputmode", "numeric");
  input.setAttribute("pattern", "[0-9]*");
  input.setAttribute("min", "0");
  input.setAttribute("step", "1");

  // Chặn ký tự không phải 0-9
  input.addEventListener("keydown", (e) => {
    const ok = ["Backspace","Delete","ArrowLeft","ArrowRight","Tab","Home","End"];
    if (ok.includes(e.key)) return;
    if (!/^[0-9]$/.test(e.key)) e.preventDefault();
  });

  // Tự làm sạch giá trị nếu có ký tự lạ
  input.addEventListener("input", () => {
    const cleaned = input.value.replace(/\D+/g, "");
    if (cleaned !== input.value) input.value = cleaned;
  });

  // Lọc khi dán
  input.addEventListener("paste", (e) => {
    e.preventDefault();
    const text = (e.clipboardData || window.clipboardData).getData("text") || "";
    const digits = text.replace(/\D+/g, "");
    document.execCommand("insertText", false, digits);
  });
}
