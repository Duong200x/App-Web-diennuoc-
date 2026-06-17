// src/sync/room.js
import { residentIdentity, residentKey, slug, deaccent } from "../utils/normalize.js";
import { initFirebase, getDb, ensureAuth } from "./firebase.js";
import {
  collection, doc, setDoc, deleteDoc, getDocs, getDoc, onSnapshot, serverTimestamp, runTransaction
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
const tsOf = (row) => Date.parse(row?.updatedAt || row?.updated_at || 0) || 0;

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

function stripLocalOnly(row = {}) {
  const { __pendingSync, ...rest } = row || {};
  return rest;
}

function clearPendingForResident(id, pushedUpdatedAt = "") {
  if (!id) return;
  const rows = getJSON(KEYS.current, []) || [];
  const pushedTs = Date.parse(pushedUpdatedAt || 0) || 0;
  let touched = false;
  const next = rows.map((row) => {
    if (residentIdentity(row) !== id || !row.__pendingSync) return row;
    if (pushedTs && tsOf(row) > pushedTs) return row;
    touched = true;
    return stripLocalOnly(row);
  });
  if (touched) setJSON(KEYS.current, next);
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

function mergeResidentRows(localRows = [], remoteRows = []) {
  const map = new Map();
  safeArray(localRows).forEach((row, idx) => {
    map.set(residentIdentity(row), {
      ...row,
      __order: Number.isFinite(Number(row?.__order)) ? Number(row.__order) : idx,
    });
  });

  safeArray(remoteRows).forEach((remote, idx) => {
    if (remote?._deleted) return;
    const key = residentIdentity(remote);
    const local = map.get(key);
    const normalizedRemote = {
      ...remote,
      __pendingSync: false,
      isSynced: true,
      __order: Number.isFinite(Number(remote?.__order)) ? Number(remote.__order) : idx,
    };
    if (!local) {
      map.set(key, normalizedRemote);
      return;
    }
    if (local.__pendingSync) return;
    if (tsOf(remote) >= tsOf(local)) map.set(key, normalizedRemote);
  });

  return dedupeRows(Array.from(map.values()));
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
    const tNew = tsOf(r);
    const tOld = tsOf(prev);
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
const KEY_HISTORY_PENDING = "__history_pending_sync";
function hasHistoryPending() { try { return localStorage.getItem(KEY_HISTORY_PENDING) === "1"; } catch { return false; } }
function clearHistoryPending() { try { localStorage.removeItem(KEY_HISTORY_PENDING); } catch {} }

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
  if (!db) throw new Error("Khong the ket noi Firebase de dong bo danh sach cu dan.");

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
      const pushedAt = it.updatedAt || nowIso();
      await setDoc(doc(col, id), { ...stripLocalOnly(it), _deleted: false, updatedAt: pushedAt }, { merge: true });
      clearPendingForResident(id, pushedAt);
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
  if (!db) throw new Error("Khong the ket noi Firebase de dong bo cu dan.");

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
    const pushedAt = normalized.updatedAt || nowIso();
    await setDoc(doc(col, id), { ...stripLocalOnly(normalized), _deleted: false, updatedAt: pushedAt }, { merge: true });
    const del = getDeletedSet(); if (del.delete(id)) saveDeletedSet(del);
    clearPendingForResident(id, pushedAt);
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
  if (!db) throw new Error("Khong the ket noi Firebase de dong bo lich su.");

  try {
    // luôn backup local (giữ 5 bản) trước khi đẩy
    try { saveBackupLocal(5); } catch (e) { console.warn("[backup] skip:", e?.message || e); }

    const localHistory = getJSON(KEYS.history, {});
    const baseHistory = getJSON(KEY_LAST_SYNCED_HISTORY, {});
    
    // Tìm các tháng có thay đổi giữa local và base
    const changedMonths = [];
    const allMonths = new Set([...Object.keys(localHistory), ...Object.keys(baseHistory)]);
    for (const m of allMonths) {
      if (JSON.stringify(localHistory[m] || []) !== JSON.stringify(baseHistory[m] || [])) {
        changedMonths.push(m);
      }
    }

    let finalMergedObj = { ...localHistory };

    // Chỉ gọi transaction nếu có tháng nào bị thay đổi
    if (changedMonths.length > 0) {
      await runTransaction(db, async (transaction) => {
        const remoteSnapshots = {};
        
        // 1. Đọc tất cả các tháng bị thay đổi từ thư mục history_v2 mới
        for (const month of changedMonths) {
          const docRef = doc(db, "rooms", rid, "history_v2", month);
          const sfDoc = await transaction.get(docRef);
          remoteSnapshots[month] = sfDoc.exists() ? (sfDoc.data()?.history || []) : [];
        }
        
        // 2. Gộp 3 chiều và Ghi lại
        for (const month of changedMonths) {
          const base = { [month]: baseHistory[month] || [] };
          const local = { [month]: localHistory[month] || [] };
          const remote = { [month]: remoteSnapshots[month] };
          
          const mergedObj = mergeHistoryObjects(base, local, remote);
          finalMergedObj[month] = mergedObj[month] || [];
          
          const docRef = doc(db, "rooms", rid, "history_v2", month);
          transaction.set(docRef, { history: finalMergedObj[month], updatedAt: nowIso() }, { merge: true });
        }
      });
    }

    // cập nhật local sau khi gộp
    setJSON(KEYS.history, finalMergedObj);

    // sau push thành công -> cập nhật base cho merge lần sau
    setJSON(KEY_LAST_SYNCED_HISTORY, finalMergedObj);
    clearHistoryPending();

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

export function hasPendingRoomChanges() {
  const residentPending = listResidents().some((row) => !!row.__pendingSync);
  return residentPending || hasHistoryPending();
}

export async function pushPendingRoomChanges(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return { residents: 0, history: false };
  let residents = 0;
  const pendingRows = listResidents().filter((row) => !!row.__pendingSync);
  for (const row of pendingRows) {
    await pushOneResident(row, rid);
    residents += 1;
  }
  const history = hasHistoryPending();
  if (history) await pushHistoryAll(rid);
  if (residents || history) await pushMonthPtr(rid);
  return { residents, history };
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

    let remoteMonth = "";
    try {
      const metaSnap = await getDoc(metaDocRef(db, rid));
      if (metaSnap.exists()) {
        remoteMonth = String(metaSnap.data()?.month || "");
        const localMonth = getStr(KEYS.month, "");
        if (remoteMonth >= localMonth) {
          setStr(KEYS.month, remoteMonth);
        }
      }
    } catch (e) {
      console.warn("[room] Initial getDoc meta failed:", e);
    }

    // 1) Residents
    const colRef = collection(db, "rooms", rid, "residents");
    unsubResidents = onSnapshot(colRef, (qsnap) => {
      try {
        const localMonth = getStr(KEYS.month, "");
        if (remoteMonth && remoteMonth < localMonth) {
          console.warn(`[room] skip applying remote residents snapshot because remote month ${remoteMonth} < local month ${localMonth}`);
          return;
        }

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
          if (it.__pendingSync) return true;

          // Tránh snapshot rỗng tạm thời xoá sạch dữ liệu local
          if (qsnap.empty && curr.length > 0) return true;

          if (id && !liveKeys.has(id)) {
            // Chỉ xoá khỏi local khi nó đã từng được sync thành công lên server 
            if (it.isSynced) return false;
            return true; // Chưa từng sync thành công thì giữ lại
          }
          return true;
        });

        const filteredLive = live.filter(r => !delSet.has(residentIdentity(r)));

        // Merge và dedupe
        const merged = mergeResidentRows(updated, filteredLive);
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
            remoteMonth = String(meta.month);
            const localMonth = getStr(KEYS.month, "");
            if (remoteMonth >= localMonth) {
              setStr(KEYS.month, remoteMonth);
              notify();
            } else {
              console.warn(`[room] remote month ${remoteMonth} is older than local month ${localMonth}, skip downgrade.`);
            }
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

  // 3) History V2 (MERGE 3-CHIỀU an toàn)
  unsubHistory = onSnapshot(collection(db, "rooms", rid, "history_v2"), (qsnap) => {
    try {
      const remoteHistory = {};
      qsnap.forEach(d => {
        const monthData = d.data()?.history;
        if (Array.isArray(monthData)) {
          remoteHistory[d.id] = monthData;
        }
      });

      const localHistory = getJSON(KEYS.history, {});
      const baseHistory = getJSON(KEY_LAST_SYNCED_HISTORY, {});
      
      const finalMergedObj = mergeHistoryObjects(baseHistory, localHistory, remoteHistory);
      
      setJSON(KEYS.history, finalMergedObj);
      setJSON(KEY_LAST_SYNCED_HISTORY, finalMergedObj);
      
      notify();
    } catch (e) {
      console.warn("[room] onSnapshot history_v2 failed:", e?.message || e);
      emitRoomError(e);
    }
  }, (err) => {
    console.warn("[room] onSnapshot history_v2 error:", err?.message || err);
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

  try {
    setStr(KEYS.roomId, rid);
    const snap = await pullRoomToLocal(rid);
    subscribeRoom(null, rid);
    return safeArray(snap.current).length;
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
  if (!db) throw new Error("Khong the ket noi Firebase de tai du lieu phong.");

  const residentsSnap = await getDocs(collection(db, "rooms", rid, "residents"));
  const residents = [];
  residentsSnap.forEach((d) => {
    const data = d.data() || {};
    if (data._deleted) return;
    residents.push({ ...data, id: data.id || data.residentId || d.id, residentId: data.residentId || data.id || d.id });
  });

  // Lấy bản Backup cũ từ history/all (Fallback)
  const historySnap = await getDocs(collection(db, "rooms", rid, "history"));
  let history = {};
  historySnap.forEach((d) => {
    if (d.id !== "all") return;
    const data = d.data() || {};
    history = data.history && typeof data.history === "object" ? data.history : {};
  });

  // Lấy các mảnh đã chia từ history_v2 và ghi đè/gộp vào bản cũ
  const historyV2Snap = await getDocs(collection(db, "rooms", rid, "history_v2"));
  historyV2Snap.forEach((d) => {
    const data = d.data() || {};
    const monthData = data.history;
    if (Array.isArray(monthData)) {
      history[d.id] = monthData;
    }
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
  const localMonth = getStr(KEYS.month, "");
  
  if (snap.month) {
    if (snap.month >= localMonth) {
      setStr(KEYS.month, snap.month);
    } else {
      console.warn(`[room] pullRoomToLocal: remote month ${snap.month} is older than local month ${localMonth}, skip downgrade.`);
    }
  }
  
  const effectiveMonth = snap.month || localMonth;
  if (effectiveMonth >= localMonth) {
    const localCurrent = getJSON(KEYS.current, []) || [];
    const mergedCurrent = mergeResidentRows(localCurrent, snap.current || []);
    setJSON(KEYS.current, mergedCurrent);
  } else {
    console.warn(`[room] pullRoomToLocal: skip merging residents because remote month ${snap.month} < local month ${localMonth}`);
  }
  
  setJSON(KEYS.history, snap.history || {});
  return { ...snap, current: getJSON(KEYS.current, []) };
}

export function unsubscribeRoom() {
  if (unsubResidents) { try { unsubResidents(); } catch {} unsubResidents = null; }
  if (unsubMeta)      { try { unsubMeta(); }      catch {} unsubMeta = null; }
  if (unsubHistory)   { try { unsubHistory(); }   catch {} unsubHistory = null; }
}

export function disconnectRoomRuntime() {
  unsubscribeRoom();
  try { pushQueue.pause(); } catch {}
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
  localStorage.removeItem(KEY_HISTORY_PENDING);
}
