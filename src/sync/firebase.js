// src/sync/firebase.js
// Firebase init + Firestore với Offline Persistence (IndexedDB) an toàn đa-tab.
// Giữ API cũ: initFirebase() và getDb()

import { initializeApp, getApps } from "firebase/app";
import {
  getAuth,
  initializeAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  enableIndexedDbPersistence,
  enableMultiTabIndexedDbPersistence,
  CACHE_SIZE_UNLIMITED,
} from "firebase/firestore";

let _app = null;
let _db  = null;
let _auth = null;

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

function getAuthInstance() {
  if (!_app) throw new Error("Firebase hasn't been initialized");
  if (_auth) return _auth;

  try {
    _auth = initializeAuth(_app, {
      persistence: [
        indexedDBLocalPersistence,
        browserLocalPersistence,
        browserSessionPersistence,
      ],
    });
  } catch {
    _auth = getAuth(_app);
  }

  return _auth;
}

let _authPromise = null;

export function ensureAuth() {
  // Bắt buộc gọi sau khi initFirebase()
  if (!_app) return Promise.reject(new Error("Firebase hasn't been initialized"));

  const auth = getAuthInstance();
  if (auth.currentUser) return Promise.resolve(auth.currentUser);

  if (!_authPromise) {
    _authPromise = new Promise((resolve, reject) => {
      // Thiết lập timeout 20s cho việc đăng nhập
      const timeout = setTimeout(() => {
        _authPromise = null;
        reject(new Error("Hết thời gian chờ đăng nhập (Timeout)."));
      }, 20000);

      const unsub = onAuthStateChanged(auth, async (user) => {
        clearTimeout(timeout);
        unsub(); 
        
        if (user) {
          resolve(user);
        } else {
          // Chỉ hiện prompt nếu thực sự chưa có user
          // Sử dụng setTimeout để không block main thread ngay lập tức
          setTimeout(async () => {
            const pwd = prompt("Bảo mật hệ thống đồng bộ (Online Sync)\nVui lòng nhập mật khẩu quản trị:");
            
            if (!pwd) {
              console.warn("[auth] No password provided.");
              _authPromise = null;
              reject(new Error("Đã hủy đăng nhập. Tác vụ đồng bộ phòng đã dừng lại."));
              return;
            }

            try {
              const cred = await signInWithEmailAndPassword(auth, "quanly@diennuoc.com", pwd);
              resolve(cred.user);
            } catch (e) {
              _authPromise = null;
              reject(new Error("Mật khẩu không đúng hoặc lỗi mạng: " + e.message));
            }
          }, 50);
        }
      });
    });
  }
  return _authPromise;
}

export async function clearAuthSession() {
  if (!_app) return;
  const auth = getAuthInstance();
  _authPromise = null;
  try {
    await signOut(auth);
  } catch (e) {
    console.warn("[auth] signOut failed:", e?.message || e);
  }
}

