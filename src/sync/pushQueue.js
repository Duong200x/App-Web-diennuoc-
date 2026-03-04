// src/sync/pushQueue.js
//
// Hàng đợi đẩy Firestore an toàn cho môi trường online/offline:
// - Gộp (coalesce) các tác vụ cùng "key" → chỉ giữ lần mới nhất (ví dụ: HISTORY).
// - Thực thi tuần tự (maxConcurrency = 1) để tránh race-condition ghi/đè.
// - Tự động tạm dừng khi offline, tiếp tục khi online.
// - Retry với exponential backoff, có jitter, dừng ở maxBackoffMs.
// - Có flush() để ép chạy ngay, và drain() đợi chạy hết.
// - Không phụ thuộc framework. Task là 1 hàm async không nhận tham số, tự đọc state hiện tại.
//
// Cách dùng (ở bước tiếp theo sẽ chỉnh room.js gọi qua queue):
//   import { pushQueue } from "./pushQueue.js";
//   // đẩy 1 cư dân (key theo id để không đè nhau):
//   pushQueue.enqueue({ key: `RESIDENT:${id}`, label: 'resident', run: () => pushOneResidentRaw(it) });
//   // đẩy lịch sử (key cố định để gộp):
//   pushQueue.enqueue({ key: 'HISTORY', label: 'history', run: () => pushHistoryAllRaw() });
//
// Gợi ý tích hợp (bước sau):
// - Đổi các chỗ gọi pushHistoryAll() thành: pushQueue.enqueue({ key:'HISTORY', label:'history', run: () => pushHistoryAll() })
// - Đổi pushOneResident(it) thành: pushQueue.enqueue({ key:`RESIDENT:${id}`, label:'resident', run: () => pushOneResident(it) })

const DEFAULTS = {
  maxConcurrency: 1,
  backoffBaseMs: 700,     // ms
  maxBackoffMs: 12000,    // ms
  maxRetries: 6,          // ~ tổng thời gian tối đa ~ vài chục giây
  idleDebounceMs: 150,    // đợi gom thêm tác vụ trong khung ngắn trước khi chạy
  log: true,
};

function now() { return Date.now(); }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function jitter(ms, rate = 0.2) {
  const d = ms * rate;
  return Math.max(0, ms + (Math.random() * 2 - 1) * d);
}
function isOnline() {
  if (typeof navigator === "undefined") return true;
  if (typeof navigator.onLine !== "boolean") return true;
  return navigator.onLine;
}

/** Một item trong queue */
class QItem {
  constructor({ key, label, run }) {
    this.key = key;           // dùng để gộp (coalesce)
    this.label = label || ""; // để log
    this.run = run;           // async () => void
    this.enqueuedAt = now();
    this.retries = 0;
    this.nextDelay = 0;
  }
}

/** Hàng đợi tuần tự + gộp theo key */
class PushQueue {
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...(opts || {}) };
    this.pendingMap = new Map();   // key -> QItem (giữ task mới nhất cho key)
    this.order = [];               // thứ tự keys sẽ xử lý (FIFO)
    this.running = 0;
    this.paused = false;
    this._debounceTimer = null;
    this._drainResolvers = [];
    this._onlineHandler = this._onOnline.bind(this);
    this._offlineHandler = this._onOffline.bind(this);
    this._visHandler = this._onVisibility.bind(this);

    if (typeof window !== "undefined") {
      window.addEventListener("online", this._onlineHandler);
      window.addEventListener("offline", this._offlineHandler);
      document.addEventListener("visibilitychange", this._visHandler);
    }
  }

  log(...args) { if (this.cfg.log) console.log("[pushQueue]", ...args); }
  warn(...args) { if (this.cfg.log) console.warn("[pushQueue]", ...args); }

  /** Gỡ sự kiện khi không còn dùng (ít khi cần) */
  destroy() {
    if (typeof window !== "undefined") {
      window.removeEventListener("online", this._onlineHandler);
      window.removeEventListener("offline", this._offlineHandler);
      document.removeEventListener("visibilitychange", this._visHandler);
    }
    this._clearDebounce();
  }

  _clearDebounce() {
    if (this._debounceTimer) {
      clearTimeout(this._debounceTimer);
      this._debounceTimer = null;
    }
  }

  _scheduleRunSoon() {
    if (this._debounceTimer) return;
    this._debounceTimer = setTimeout(() => {
      this._debounceTimer = null;
      this._pump();
    }, this.cfg.idleDebounceMs);
  }

  /** Đưa task vào hàng đợi; nếu key tồn tại thì thay bằng task mới (gộp) */
  enqueue({ key, label, run }) {
    if (!key || typeof run !== "function") throw new Error("enqueue() cần key và run()");
    const item = new QItem({ key, label, run });

    if (!this.pendingMap.has(key)) {
      this.order.push(key);
    }
    this.pendingMap.set(key, item);

    // nếu đang tạm dừng do offline thì chờ online; nếu đang rảnh thì hẹn chạy sớm
    if (!this.paused) this._scheduleRunSoon();
    return item;
  }

  pause() { this.paused = true; }
  resume() { this.paused = false; this._scheduleRunSoon(); }

  /** Ép chạy ngay không chờ debounce; thường dùng khi user bấm Lưu */
  async flush() {
    this._clearDebounce();
    await this._pump(true);
  }

  /** Trả Promise hoàn tất khi hàng đợi rỗng */
  drain() {
    return new Promise((resolve) => {
      if (this.pendingMap.size === 0 && this.running === 0) return resolve();
      this._drainResolvers.push(resolve);
      this._scheduleRunSoon();
    });
  }

  _resolveDrainsIfIdle() {
    if (this.pendingMap.size === 0 && this.running === 0) {
      const list = this._drainResolvers.splice(0);
      for (const r of list) try { r(); } catch {}
    }
  }

  async _pump(immediate = false) {
    if (this.paused) return;
    if (!isOnline()) { this.pause(); return; }
    if (this.running >= this.cfg.maxConcurrency) return;

    // lấy key tiếp theo
    const key = this.order[0];
    if (!key) { this._resolveDrainsIfIdle(); return; }

    const item = this.pendingMap.get(key);
    if (!item) { // có thể bị gỡ khi coalesce
      this.order.shift();
      return this._pump(immediate);
    }

    // Nếu item có lịch delay (retry) và chưa đến hạn → hẹn lại
    const dueIn = item.nextDelay > 0 ? item.nextDelay - (now() - item.enqueuedAt) : 0;
    if (dueIn > 0 && !immediate) {
      // hẹn tick sau
      setTimeout(() => this._pump(), Math.min(dueIn, 300));
      return;
    }

    // chạy 1 task
    this.running++;
    this.order.shift();            // lấy ra khỏi FIFO
    this.pendingMap.delete(key);   // bỏ khỏi pending (nếu task fail sẽ enqueue lại)

    try {
      await item.run();
      this.log(`✓ done: ${item.label || key}`);
    } catch (err) {
      // xử lý retry
      const canRetry = item.retries < this.cfg.maxRetries;
      if (!isOnline()) {
        this.warn(`⚠ offline, queue paused`);
        this.pause();
      }
      if (canRetry) {
        item.retries++;
        const base = this.cfg.backoffBaseMs * Math.pow(2, item.retries - 1);
        const delay = Math.min(this.cfg.maxBackoffMs, base);
        item.nextDelay = jitter(delay);
        item.enqueuedAt = now(); // mốc mới để tính dueIn
        this.warn(`⟳ retry #${item.retries} in ~${Math.round(item.nextDelay)}ms for ${item.label || key}:`, err?.message || err);
        // đưa lại vào hàng, cuối danh sách để nhường task khác
        const existed = this.pendingMap.has(key);
        if (!existed) {
          this.order.push(key);
          this.pendingMap.set(key, item);
        } else {
          // nếu vừa có task cùng key được thêm mới → giữ bản mới nhất (đã set trong enqueue)
        }
      } else {
        this.warn(`✗ failed (max retries reached) for ${item.label || key}:`, err?.message || err);
      }
    } finally {
      this.running--;
      // tiếp tục nếu còn
      if (!this.paused) this._scheduleRunSoon();
      this._resolveDrainsIfIdle();
    }
  }

  _onOnline() {
    this.log("online → resume queue");
    this.resume();
  }
  _onOffline() {
    this.warn("offline → pause queue");
    this.pause();
  }
  _onVisibility() {
    if (document.visibilityState === "visible" && !this.paused) {
      // Khi tab quay lại foreground, cố gắng bơm tiếp
      this._scheduleRunSoon();
    }
  }
}

// Singleton dùng chung toàn app
export const pushQueue = new PushQueue();

// Helper nhanh theo “loại” tác vụ (tuỳ chọn):
export const enqueueHistory = (run) =>
  pushQueue.enqueue({ key: "HISTORY", label: "history", run });

export const enqueueResident = (id, run) =>
  pushQueue.enqueue({ key: `RESIDENT:${id}`, label: `resident:${id}`, run });

export default pushQueue;
