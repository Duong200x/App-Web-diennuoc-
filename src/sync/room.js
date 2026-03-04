// src/sync/room.js
import { residentKey, slug, deaccent } from "../utils/normalize.js";
import { initFirebase, getDb } from "./firebase.js";
import {
  collection, doc, setDoc, getDocs, onSnapshot, serverTimestamp,
} from "firebase/firestore";
import { getJSON, setJSON, getStr, setStr, KEYS } from "../state/storage.js";
import { listResidents } from "../state/readings.js";
import { saveBackupLocal } from "../state/backup.js";
import { mergeHistoryObjects } from "./safeMerge.js"; // merge 3-chiều
import { enqueueHistory, enqueueResident, pushQueue } from "./pushQueue.js"; // hàng đợi đẩy

/* ================= Helpers ================= */
// (Common slug/norm helpers moved to normalize.js)
const norm = (s) => deaccent(s).toLowerCase().trim();
const nowIso = () => new Date().toISOString();

// Helper: Cập nhật timestamp cho room gốc (để Cloud Functions biết phòng còn hoạt động)
async function touchRoomTimestamp(rid) {
  const db = fdb();
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
const docIdFromResident = residentKey;

// docId từ data (tombstone có name/address)
function docIdFromData(data, fallbackId) {
  return residentKey(data) || fallbackId;
}

function fdb() {
  try { return getDb() || initFirebase(); }
  catch (e) { console.warn("[room] Firebase init failed:", e?.message || e); return null; }
}

function safeArray(xs) { return Array.isArray(xs) ? xs : []; }

/** Dedupe theo name|address (slug), chọn updatedAt mới nhất & BỎ tài liệu _deleted */
function dedupeRows(rows) {
  const m = new Map(); // key -> row
  for (const r of safeArray(rows)) {
    if (r?._deleted) continue; // bỏ tombstone
    const key = residentKey(r);
    const prev = m.get(key);
    if (!prev) { m.set(key, r); continue; }
    const tNew = Date.parse(r?.updatedAt || r?.updated_at || 0) || 0;
    const tOld = Date.parse(prev?.updatedAt || prev?.updated_at || 0) || 0;
    if (tNew >= tOld) m.set(key, r);
  }
  return Array.from(m.values());
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

/* ================= Public API ================= */
export function getRoomId() { return getStr(KEYS.roomId, ""); }
export function isInRoom() { return !!getRoomId(); }

/** Tạo phòng và đẩy đủ current + history + month */
export async function createRoom() {
  const db = fdb();
  if (!db) { console.warn("[room] No DB for createRoom"); return ""; }

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
    return "";
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

/** Phát tombstone khi xóa 1 cư dân (không deleteDoc để máy khác nhận biết mà gỡ) */
export async function pushDeleteResident(item, roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid || !item) return;
  const db = fdb(); if (!db) return;

  const col = collection(db, "rooms", rid, "residents");
  const id = item?.id || docIdFromResident(item);
  try {
    await setDoc(
      doc(col, id),
      {
        name: item.name || "",
        address: item.address || "",
        _deleted: true,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    const del = getDeletedSet(); del.add(id); saveDeletedSet(del);
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] pushDeleteResident failed:", e?.message || e);
  }
}

/* ================= LOW-LEVEL RAW PUSH (dùng trong queue) ================= */
async function _pushAllResidentsRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = fdb(); if (!db) return;

  try {
    const deleted = getDeletedSet();
    const col = collection(db, "rooms", rid, "residents");
    const rows = listResidents();
    for (const it of rows) {
      const id = it.id || docIdFromResident(it);
      if (deleted.has(id)) continue; // không đẩy lại người đã xóa
      await setDoc(doc(col, id), { ...it, _deleted: false, updatedAt: nowIso() }, { merge: true });
    }
    await touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushAllResidentsRaw failed:", e?.message || e);
  }
}

async function _pushOneResidentRaw(it, roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid || !it) return;
  const db = fdb(); if (!db) return;

  try {
    const col = collection(db, "rooms", rid, "residents");
    const id = it?.id || docIdFromResident(it || {});
    await setDoc(doc(col, id), { ...it, _deleted: false, updatedAt: nowIso() }, { merge: true });
    const del = getDeletedSet(); if (del.delete(id)) saveDeletedSet(del);
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushOneResidentRaw failed:", e?.message || e);
  }
}

async function _pushHistoryAllRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = fdb(); if (!db) return;

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
  }
}

async function _pushMonthPtrRaw(roomId = getRoomId()) {
  const rid = String(roomId || "").trim();
  if (!rid) return;
  const db = fdb(); if (!db) return;
  try {
    const month = getStr(KEYS.month, "");
    await setDoc(metaDocRef(db, rid), { month, updatedAt: nowIso() }, { merge: true });
    touchRoomTimestamp(rid);
  } catch (e) {
    console.warn("[room] _pushMonthPtrRaw failed:", e?.message || e);
  }
}

/* ================= HIGH-LEVEL API (giữ tên cũ, nhưng chạy qua queue) ================= */

/** Đẩy toàn bộ residents hiện có lên phòng (SYNC FULL) */
export async function pushAllToRoom(roomId = getRoomId()) {
  // thao tác bulk này giữ raw (không cần queue) vì gọi hiếm & có vòng lặp sẵn
  await _pushAllResidentsRaw(roomId);
}

/** Đẩy 1 cư dân – dùng trong ListView; GIỮ API cũ (await được) nhưng chạy hàng đợi */
export async function pushOneResident(it, roomId = getRoomId()) {
  const id = it?.id || docIdFromResident(it || {});
  enqueueResident(id, () => _pushOneResidentRaw(it, roomId));
  // để giữ hành vi "await pushOneResident()" không bị vô nghĩa,
  // ta ép flush queue hiện tại (chạy ngay tác vụ vừa enqueue)
  await pushQueue.flush();
}

/** Đẩy toàn bộ history hiện có lên phòng; GIỮ API cũ, chạy qua queue để coalesce */
export async function pushHistoryAll(roomId = getRoomId()) {
  enqueueHistory(() => _pushHistoryAllRaw(roomId));
  await pushQueue.flush();
}

/** Đẩy month pointer hiện tại lên phòng (ít gọi) */
export async function pushMonthPtr(roomId = getRoomId()) {
  // việc này nhỏ/nhanh nên gọi raw trực tiếp cho đơn giản
  await _pushMonthPtrRaw(roomId);
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

  const db = fdb(); if (!db) return () => {};
  if (explicitRoomId) setStr(KEYS.roomId, rid);

  // Hủy listener cũ nếu có
  unsubscribeRoom();

  const notify = makeDebounced(() => {
    if (typeof onRemoteChange === "function") onRemoteChange();
  });

  // 1) Residents
  const colRef = collection(db, "rooms", rid, "residents");
  unsubResidents = onSnapshot(colRef, (qsnap) => {
    try {
      const live = [];
      const delSet = getDeletedSet();
      const tombstones = [];

      qsnap.forEach((d) => {
        const data = d.data() || {};
        const id = d.id;

        if (data._deleted) {
          tombstones.push({ id, data });
          delSet.add(id);
        } else {
          live.push({ id, ...data });
          if (delSet.has(id)) delSet.delete(id);
        }
      });

      // Áp tombstone & gộp dữ liệu atomic để tránh race condition
      const curr = getJSON(KEYS.current, []);
      let updated = curr;

      if (tombstones.length) {
        const tIdsAndKeys = new Set(tombstones.map(t => t.id).concat(tombstones.map(t => residentKey(t.data))));
        updated = updated.filter(it => !tIdsAndKeys.has(it?.id || residentKey(it)));
      }

      // Lưu lại deleted set
      saveDeletedSet(delSet);

      // Ghi current = các bản ghi sống đã dedupe
      setJSON(KEYS.current, dedupeRows(updated.concat(live)));
      notify();
    } catch (e) {
      console.warn("[room] onSnapshot residents failed:", e?.message || e);
    }
  }, (err) => console.warn("[room] onSnapshot residents error:", err?.message || err));

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
    } catch (e) { console.warn("[room] onSnapshot meta failed:", e?.message || e); }
  }, (err) => console.warn("[room] onSnapshot meta error:", err?.message || err));

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
    } catch (e) { console.warn("[room] onSnapshot history failed:", e?.message || e); }
  }, (err) => console.warn("[room] onSnapshot history error:", err?.message || err));

  return unsubscribeRoom;
}

/** Tải 1 lần rồi bật realtime (tương thích ngược) */
export async function joinRoom(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return 0;
  const db = fdb(); if (!db) return 0;

  try {
    const snap = await getDocs(collection(db, "rooms", rid, "residents"));
    const rows = [];
    snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    setJSON(KEYS.current, dedupeRows(rows));
    setStr(KEYS.roomId, rid);
    subscribeRoom(null, rid);
    return rows.length;
  } catch (e) {
    console.warn("[room] joinRoom failed:", e?.message || e);
    return 0;
  }
}

/** Hủy lắng nghe realtime (nếu có) */
export function unsubscribeRoom() {
  if (unsubResidents) { try { unsubResidents(); } catch {} unsubResidents = null; }
  if (unsubMeta)      { try { unsubMeta(); }      catch {} unsubMeta = null; }
  if (unsubHistory)   { try { unsubHistory(); }   catch {} unsubHistory = null; }
}

/** Rời phòng: hủy listener + xóa Room ID (giữ dữ liệu hiện tại) */
export function leaveRoom() {
  unsubscribeRoom();
  setStr(KEYS.roomId, "");
}
