// src/sync/firebase.js
// Firebase init + Firestore với Offline Persistence (IndexedDB) an toàn đa-tab.
// Giữ API cũ: initFirebase() và getDb()

import { initializeApp, getApps } from "firebase/app";
import {
  getFirestore,
  initializeFirestore,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";

let _app = null;
let _db  = null;

// === Cấu hình Firebase từ biến môi trường (.env) ===
const FBCONFIG = {
  apiKey:            import.meta.env.VITE_FB_API_KEY,
  authDomain:        import.meta.env.VITE_FB_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FB_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FB_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FB_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FB_APP_ID,
};

export function initFirebase() {
  if (_db) return _db;

  // 1) initializeApp (idempotent)
  if (!getApps().length) {
    _app = initializeApp(FBCONFIG);
  } else {
    _app = getApps()[0];
  }

  // 2) initializeFirestore với cache lớn + ignoreUndefinedProperties
  try {
    _db = initializeFirestore(_app, {
      cacheSizeBytes: CACHE_SIZE_UNLIMITED,
      ignoreUndefinedProperties: true,
      experimentalForceLongPolling: !!(window && window.Capacitor), // ổn định hơn trên Android WebView
    });
  } catch {
    _db = getFirestore(_app);
  }

  // 3) Bật IndexedDB persistence:
  //    - Ưu tiên multi-tab; nếu fail (ownership) thì fallback single-tab.
  (async () => {
    try {
      await enableMultiTabIndexedDbPersistence(_db);
      console.log("[firebase] Persistence: MultiTab enabled");
    } catch (e1) {
      console.warn("[firebase] MultiTab persistence failed:", e1?.message || e1);
      try {
        await enableIndexedDbPersistence(_db);
        console.log("[firebase] Persistence: SingleTab enabled");
      } catch (e2) {
        // Safari Private hoặc môi trường không hỗ trợ => vẫn chạy online bình thường
        console.warn("[firebase] IndexedDB persistence not available:", e2?.message || e2);
      }
    }
  })();

  return _db;
}

export function getDb() {
  return _db;
}
