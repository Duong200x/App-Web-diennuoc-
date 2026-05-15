// src/sync/room.js
import { residentIdentity, residentKey, slug, deaccent } from "../utils/normalize.js";
import { initFirebase, getDb, ensureAuth } from "./firebase.js";
import {
  collection, doc, setDoc, deleteDoc, getDocs, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { getJSON, setJSON, getStr, setStr, KEYS } from "../state/storage.js";
import { listResidents } from "../state/readings.js";
import { saveBackupLocal } from "../state/backup.js";
import { pushQueue } from "./pushQueue.js";
import { mergeHistoryObjects } from "./safeMerge.js"; // merge 3-chiều

/* ================= Helpers ================= */
// (Common slug/norm helpers moved to normalize.js)
const norm = (s) => deaccent(s).toLowerCase().trim();
const nowIso = () => new Date().toISOString();

function emitRoomError(errorOrMessage) {
  const message = typeof errorOrMessage === "string"
    ? errorOrMessage
    : (errorOrMessage?.message || String(errorOrMessage || "Loi dong bo phong."));
  try {
    window.dispatchEvent(new CustomEvent("room:sync-error", {
      detail: { message },
    }));
  } catch {}
}

async function touchRoomTimestamp(rid) {
  const db = await fdbAsync();
  if (!db || !rid) return;
  try {
    const roomRef = doc(db, "rooms", rid);
    // Dùng serverTimestamp để Cloud Functions check chính xác
    await setDoc(roomRef, { updatedAt: nowIso(), lastActive: serverTimestamp() }, { merge: true });
  } catch (e) {
    console.warn("[room] touch failed:", e);
  }
}

function shortHash(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36).slice(0, 6);
}

// ID ổn định theo name|address
const docIdFromResident = residentIdentity;

// docId từ data (tombstone có name/address)
function docIdFromData(data, fallbackId) {
  return residentIdentity(data) || fallbackId;
}

function fdb() {
  try { return getDb() || initFirebase(); }
  catch (e) { console.warn("[room] Firebase init failed:", e?.message || e); return null; }
}

export async function fdbAsync() {
  try {
    const db = getDb() || initFirebase();
    if (!db) return null;
    const user = await ensureAuth();
    if (!user) return null; // Bị huỷ hoặc chưa nhập pass
    return db;
  } catch (e) {
    console.warn("[room] Auth/Init failed:", e?.message || e);
    return null;
  }
}

function safeArray(xs) { return Array.isArray(xs) ? xs : []; }

function sortRowsByOrder(rows) {
  const list = safeArray(rows).map((row, idx) => ({ row, idx }));
  const hasOrder = list.some(({ row }) => Number.isFinite(Number(row?.__order)));
  if (!hasOrder) return list.map(({ row }) => row);
  return list
    .sort((a, b) => {
      const ao = Number.isFinite(Number(a.row?.__order)) ? Number(a.row.__order) : Number.MAX_SAFE_INTEGER;
      const bo = Number.isFinite(Number(b.row?.__order)) ? Number(b.row.__order) : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.idx - b.idx;
    })
    .map(({ row }) => row);
}

/** Dedupe theo name|address (slug), chọn updatedAt mới nhất & BỎ tài liệu _deleted */
function dedupeRows(rows) {
  const m = new Map(); // key -> row
  const softToKey = new Map();
  for (const r of safeArray(rows)) {
    if (r?._deleted) continue; // bỏ tombstone
    const key = residentIdentity(r);
    const softKey = residentKey(r);
    const prevKey = (softKey && softToKey.get(softKey)) || key;
    const prev = m.get(prevKey);
    if (!prev) {
      m.set(key, r);
      if (softKey) softToKey.set(softKey, key);
      continue;
    }
    const tNew = Date.parse(r?.updatedAt || r?.updated_at || 0) || 0;
    const tOld = Date.parse(prev?.updatedAt || prev?.updated_at || 0) || 0;
    if (tNew >= tOld) {
      if (prevKey !== key) m.delete(prevKey);
      m.set(key, r);
      if (softKey) softToKey.set(softKey, key);
    }
  }
  return sortRowsByOrder(Array.from(m.values()));
}

/* ===== Refs cho meta & history ===== */
function metaDocRef(db, rid)    { return doc(db, "rooms", rid, "meta", "state"); }
function historyDocRef(db, rid) { return doc(db, "rooms", rid, "history", "all"); }

/* ====== Deleted keys local set (tránh đẩy lại) ====== */
const KEY_DELETED = "__deleted_keys";
function getDeletedSet() { return new Set(getJSON(KEY_DELETED, [])); }
function saveDeletedSet(s) { setJSON(KEY_DELETED, Array.from(s || [])); }

/* ====== Mốc cập nhật history local (để ưu tiên so với snapshot remote cũ) ====== */
const KEY_HISTORY_TOUCH = "__history_updated_at";
function touchHistoryLocal() { try { localStorage.setItem(KEY_HISTORY_TOUCH, String(Date.now())); } catch {} }
function getHistoryTouch()   { try { return Number(localStorage.getItem(KEY_HISTORY_TOUCH) || 0); } catch { return 0; } }

/* ====== Mốc base (last synced) cho merge 3-chiều ====== */
const KEY_LAST_SYNCED_HISTORY = "__last_synced_history";
let syncTaskSeq = 0;

async function enqueueSyncTask({ key, label, run }) {
  let lastError = null;
  const queueKey = `${key}#${++syncTaskSeq}`;
  pushQueue.enqueue({
    key: queueKey,
    label,
    run: async () => {
      lastError = null;
      try {
        await run();
      } catch (e) {
        lastError = e;
        throw e;
      }
    },
  });
  await pushQueue.flush();
  await pushQueue.drain();
  if (lastError) throw lastError;
}

/* ================= Public API ================= */
export function getRoomId() { return getStr(KEYS.roomId, ""); }
export function isInRoom() { return !!getRoomId(); }

export async function createRoom() {
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de tao phong.");

  const roomId = Math.random().toString(36).slice(2, 8).toUpperCase();
  try {
    await setDoc(doc(db, "rooms", roomId), { createdAt: nowIso() }, { merge: true });
    setStr(KEYS.roomId, roomId);
    await pushAllToRoom(roomId);
    await pushHistoryAll(roomId); // đã dùng queue + flush (xem định nghĩa bên dưới)
    await pushMonthPtr(roomId);
    return roomId;
  } catch (e) {
    console.warn("[room] createRoom failed:", e?.message || e);
    throw e;
  }
}

/** Lưu roomId và bật realtime subscribe */
export function enterRoom(roomId, onRemoteChange) {
  const rid = String(roomId || "").trim();
  if (!rid) return () => {};
  setStr(KEYS.roomId, rid);
  return subscribeRoom(onRemoteChange, rid);
}

/* ================= Push helpers ================= */

/** Xóa hẳn tài liệu khỏi Firestore (Hard Delete) */
export async function pushDeleteResident(item, roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid || !item) return;
  const id = item?.id || docIdFromResident(item);
  await enqueueSyncTask({
    key: `DELETE:${rid}:${id}`,
    label: `delete:${id}`,
    run: async () => {
      const db = await fdbAsync(); if (!db) return;
      const col = collection(db, "rooms", rid, "residents");
      try {
        await deleteDoc(doc(col, id));

        // Ghi nhận vào hàng chờ xoá để onSnapshot không lôi nó ngược lại
        const del = getDeletedSet();
        del.add(id);
        saveDeletedSet(del);

        await touchRoomTimestamp(rid);
      } catch (e) {
        console.warn("[room] pushDeleteResident failed:", e?.message || e);
        throw e;
      }
    },
  });
}

/* ================= LOW-LEVEL RAW PUSH (dùng trong queue) ================= */
async function _pushAllResidentsRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de dong bo danh sach cu dan.");

  try {
    const deleted = getDeletedSet();
    const col = collection(db, "rooms", rid, "residents");
    const rows = listResidents().map((it, idx) => ({
      ...it,
      __order: Number.isFinite(Number(it?.__order)) ? Number(it.__order) : idx,
    }));
    for (const it of rows) {
      const id = it.id || docIdFromResident(it);
      if (deleted.has(id)) continue; // không đẩy lại người đã xóa
      await setDoc(doc(col, id), { ...it, _deleted: false, updatedAt: nowIso() }, { merge: true });
    }
    await touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushAllResidentsRaw failed:", e?.message || e);
    throw e;
  }
}

async function _pushOneResidentRaw(it, roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid || !it) return;
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de dong bo cu dan.");

  try {
    const col = collection(db, "rooms", rid, "residents");
    const currentRows = listResidents();
    const currentIdx = currentRows.findIndex((row) => residentIdentity(row) === residentIdentity(it || {}));
    const normalized = {
      ...it,
      __order: Number.isFinite(Number(it?.__order))
        ? Number(it.__order)
        : (currentIdx >= 0 ? currentIdx : currentRows.length),
    };
    const id = normalized?.id || docIdFromResident(normalized || {});
    await setDoc(doc(col, id), { ...normalized, _deleted: false, updatedAt: nowIso() }, { merge: true });
    const del = getDeletedSet(); if (del.delete(id)) saveDeletedSet(del);
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushOneResidentRaw failed:", e?.message || e);
    throw e;
  }
}

async function _pushHistoryAllRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de dong bo lich su.");

  try {
    // luôn backup local (giữ 5 bản) trước khi đẩy
    try { saveBackupLocal(5); } catch (e) { console.warn("[backup] skip:", e?.message || e); }

    const historyObj = getJSON(KEYS.history, {});
    await setDoc(historyDocRef(db, rid), { history: historyObj, updatedAt: nowIso() }, { merge: true });

    // sau push thành công -> cập nhật base cho merge lần sau
    setJSON(KEY_LAST_SYNCED_HISTORY, historyObj);

    touchHistoryLocal(); // đánh dấu local vừa sync
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushHistoryAllRaw failed:", e?.message || e);
    throw e;
  }
}

async function _pushMonthPtrRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de dong bo thang hien tai.");
  try {
    const month = getStr(KEYS.month, "");
    await setDoc(metaDocRef(db, rid), { month, updatedAt: nowIso() }, { merge: true });
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushMonthPtrRaw failed:", e?.message || e);
    throw e;
  }
}

/* ================= HIGH-LEVEL API (giữ tên cũ, nhưng chạy qua queue) ================= */

/** Đẩy toàn bộ residents hiện có lên phòng (SYNC FULL) */
export async function pushAllToRoom(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  await enqueueSyncTask({
    key: `RESIDENTS:${rid}`,
    label: `residents:${rid}`,
    run: () => _pushAllResidentsRaw(rid),
  });
}

/** Đẩy 1 cư dân – dùng trong ListView; GIỮ API cũ (await được) nhưng chạy hàng đợi */
export async function pushOneResident(it, roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  const id = it?.id || docIdFromResident(it || {});
  if (!rid || !id) return;
  await enqueueSyncTask({
    key: `RESIDENT:${rid}:${id}`,
    label: `resident:${id}`,
    run: () => _pushOneResidentRaw(it, rid),
  });
}

/** Đẩy toàn bộ history hiện có lên phòng */
export async function pushHistoryAll(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  await enqueueSyncTask({
    key: `HISTORY:${rid}`,
    label: `history:${rid}`,
    run: () => _pushHistoryAllRaw(rid),
  });
}

/** Đẩy month pointer hiện tại lên phòng (ít gọi) */
export async function pushMonthPtr(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  await enqueueSyncTask({
    key: `MONTH:${rid}`,
    label: `month:${rid}`,
    run: () => _pushMonthPtrRaw(rid),
  });
}

/* ================= Realtime subscribe ================= */
let unsubResidents = null;
let unsubMeta = null;
let unsubHistory = null;

/* gộp nhiều snapshot trong cùng khung hình -> 1 lần re-render */
function makeDebounced(fn) {
  let ticking = false;
  return () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; fn && fn(); });
  };
}

/**
 * Lắng nghe thay đổi state của phòng:
 * - residents -> KEYS.current (loại _deleted)
 * - meta/state -> KEYS.month
 * - history/all -> KEYS.history (ưu tiên bản local nếu mới hơn + merge 3-chiều)
 */
export function subscribeRoom(onRemoteChange, explicitRoomId) {
  const rid = explicitRoomId ? String(explicitRoomId) : getRoomId();
  if (!rid) return () => {};

  if (explicitRoomId) setStr(KEYS.roomId, rid);

  // Hủy listener cũ nếu có
  unsubscribeRoom();

  const notify = makeDebounced(() => {
    if (typeof onRemoteChange === "function") onRemoteChange();
  });

  let isSubbed = true;

  (async () => {
    let db = null;
    try {
      db = await fdbAsync();
    } catch (e) {
      emitRoomError(e);
      return;
    }
    if (!db) {
      emitRoomError("Khong the xac thuc Firebase de theo doi phong.");
      return;
    }
    if (!isSubbed) return;

    // 1) Residents
    const colRef = collection(db, "rooms", rid, "residents");
  unsubResidents = onSnapshot(colRef, (qsnap) => {
    try {
      const live = [];
      qsnap.forEach(d => {
        const data = d.data();
        // Bỏ qua nếu có cờ _deleted (tương thích cũ)
        if (!data._deleted) {
          live.push({ ...data, id: data.id || data.residentId || d.id, residentId: data.residentId || data.id || d.id });
        }
      });
      const liveKeys = new Set(live.map(r => residentIdentity(r)));
      const delSet = getDeletedSet();

      // Cập nhật delSet: nếu server đã xoá thật thì gỡ khỏi hàng chờ
      let changedDelSet = false;
      delSet.forEach(id => {
        if (!liveKeys.has(id) && qsnap.docs.length > 0) {
          delSet.delete(id);
          changedDelSet = true;
        }
      });
      if (changedDelSet) saveDeletedSet(delSet);

      const curr = getJSON(KEYS.current, []) || [];
      
      const updated = curr.filter(it => {
        const id = residentIdentity(it);
        if (delSet.has(id)) return false; 
        if (id && !liveKeys.has(id)) return false;
        return true;
      });

      const filteredLive = live.filter(r => !delSet.has(residentIdentity(r)));

      // Merge và dedupe
      const merged = dedupeRows(updated.concat(filteredLive));
      setJSON(KEYS.current, merged);
      notify();
    } catch (e) {
      console.warn("[room] onSnapshot residents failed:", e?.message || e);
      emitRoomError(e);
    }
  }, (err) => {
    console.warn("[room] onSnapshot residents error:", err?.message || err);
    emitRoomError(err);
  });

  // 2) Month pointer
  unsubMeta = onSnapshot(metaDocRef(db, rid), (dsnap) => {
    try {
      if (dsnap.exists()) {
        const meta = dsnap.data() || {};
        if (meta.month != null) {
          setStr(KEYS.month, String(meta.month));
          notify();
        }
      }
    } catch (e) {
      console.warn("[room] onSnapshot meta failed:", e?.message || e);
      emitRoomError(e);
    }
  }, (err) => {
    console.warn("[room] onSnapshot meta error:", err?.message || err);
    emitRoomError(err);
  });

  // 3) History (ưu tiên bản local nếu vừa cập nhật; tránh remote rỗng đè local; MERGE 3-CHIỀU)
  unsubHistory = onSnapshot(historyDocRef(db, rid), (dsnap) => {
    try {
      if (!dsnap.exists()) return;
      const hdoc = dsnap.data() || {};
      const remote = hdoc.history && typeof hdoc.history === "object" ? hdoc.history : null;
      if (remote == null) return;

      const remoteUpdatedAt = Date.parse(hdoc.updatedAt || 0) || 0;
      const localTouch = getHistoryTouch();
      const localObj = getJSON(KEYS.history, {}) || {};
      const baseObj  = getJSON(KEY_LAST_SYNCED_HISTORY, {}) || {};

      const localHasData  = localObj && Object.keys(localObj).length > 0;
      const remoteIsEmpty = !remote || Object.keys(remote).length === 0;

      // 1) Nếu local vừa update gần hơn -> KHÔNG đè bằng remote cũ
      if (localTouch && localTouch > remoteUpdatedAt) {
        notify();
        return;
      }

      // 2) Không cho remote rỗng đè khi local đang có dữ liệu
      if (remoteIsEmpty && localHasData) {
        console.warn("[room] skip applying empty remote history because local has data");
        notify();
        return;
      }

      // 3) Hợp nhất 3-chiều: base (lastSynced) + local + remote
      const merged = mergeHistoryObjects(baseObj, localObj, remote);

      // 4) Ghi lại local & base nếu có thay đổi
      const before = JSON.stringify(localObj);
      const after  = JSON.stringify(merged);
      if (before !== after) {
        setJSON(KEYS.history, merged);
        setJSON(KEY_LAST_SYNCED_HISTORY, merged); // cập nhật base
      }
      notify();
    } catch (e) {
      console.warn("[room] onSnapshot history failed:", e?.message || e);
      emitRoomError(e);
    }
  }, (err) => {
    console.warn("[room] onSnapshot history error:", err?.message || err);
    emitRoomError(err);
  });

  })();

  return () => {
    isSubbed = false;
    unsubscribeRoom();
  };
}

/** Tải 1 lần rồi bật realtime (tương thích ngược) */
export async function joinRoom(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return 0;
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de tham gia phong.");

  try {
    const snap = await getDocs(collection(db, "rooms", rid, "residents"));
    const rows = [];
    snap.forEach((d) => {
      const data = d.data() || {};
      rows.push({ ...data, id: data.id || data.residentId || d.id, residentId: data.residentId || data.id || d.id });
    });
    setJSON(KEYS.current, dedupeRows(rows));
    setStr(KEYS.roomId, rid);
    subscribeRoom(null, rid);
    return rows.length;
  } catch (e) {
    console.warn("[room] joinRoom failed:", e?.message || e);
    throw e;
  }
}

/** Hủy lắng nghe realtime (nếu có) */
export async function fetchRoomSnapshot(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) throw new Error("Chua vao phong.");
  const db = await fdbAsync();
  if (!db) throw new Error("Khong the xac thuc Firebase de tai du lieu phong.");

  const residentsSnap = await getDocs(collection(db, "rooms", rid, "residents"));
  const residents = [];
  residentsSnap.forEach((d) => {
    const data = d.data() || {};
    if (data._deleted) return;
    residents.push({ ...data, id: data.id || data.residentId || d.id, residentId: data.residentId || data.id || d.id });
  });

  const historySnap = await getDocs(collection(db, "rooms", rid, "history"));
  let history = {};
  historySnap.forEach((d) => {
    if (d.id !== "all") return;
    const data = d.data() || {};
    history = data.history && typeof data.history === "object" ? data.history : {};
  });

  const metaSnap = await getDocs(collection(db, "rooms", rid, "meta"));
  let month = "";
  metaSnap.forEach((d) => {
    if (d.id !== "state") return;
    const data = d.data() || {};
    month = data.month ? String(data.month) : "";
  });

  return {
    roomId: rid,
    current: dedupeRows(residents),
    history,
    month,
  };
}

export async function pullRoomToLocal(roomId = getRoomId()) {
  const snap = await fetchRoomSnapshot(roomId);
  setJSON(KEYS.current, snap.current || []);
  setJSON(KEYS.history, snap.history || {});
  if (snap.month) setStr(KEYS.month, snap.month);
  return snap;
}

export function unsubscribeRoom() {
  if (unsubResidents) { try { unsubResidents(); } catch {} unsubResidents = null; }
  if (unsubMeta)      { try { unsubMeta(); }      catch {} unsubMeta = null; }
  if (unsubHistory)   { try { unsubHistory(); }   catch {} unsubHistory = null; }
}

/** Rời phòng: hủy listener + xóa sạch dữ liệu cục bộ (tránh chồng chéo khi vào phòng khác) */
export function leaveRoom() {
  unsubscribeRoom();
  setStr(KEYS.roomId, "");

  // Clear data
  setJSON(KEYS.current, []);
  setJSON(KEYS.history, {});
  setStr(KEYS.month, "");
  saveDeletedSet(new Set()); // KEY_DELETED
  setJSON(KEY_LAST_SYNCED_HISTORY, {});
  localStorage.removeItem(KEY_HISTORY_TOUCH);
}
