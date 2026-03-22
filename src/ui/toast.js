// src/ui/toast.js

export function showToast(msg, type = 'success') {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = msg;
  document.body.appendChild(toast);
  
  // Trigger animation next frame
  requestAnimationFrame(() => {
    toast.classList.add("show");
  });

  setTimeout(() => {
    toast.classList.remove("show");
    setTimeout(() => {
      try { document.body.removeChild(toast); } catch {}
    }, 300); // Wait for fade out animation
  }, 2500); // Display duration
}
