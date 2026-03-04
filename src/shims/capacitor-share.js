export const Share = {
  async share(opts = {}) {
    if (navigator?.share) {
      try { await navigator.share(opts); } catch {}
    }
    // Không có Web Share API thì im lặng, tránh crash
  }
};
export default Share;
