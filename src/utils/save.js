// src/utils/save.js
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";

// ===== helpers =====
function abToBase64(ab) {
  const bytes = new Uint8Array(ab);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

// Share plugin (không import trực tiếp để tránh bundler lỗi)
function getShare() {
  try {
    const S =
      (typeof window !== "undefined" &&
        window.Capacitor &&
        (window.Capacitor.Plugins?.Share || window.Capacitor?.Share)) ||
      null;
    return (S && typeof S.share === "function") ? S : null;
  } catch { return null; }
}

// Web download (ổn định cho lần 1, 2, n)
async function downloadBlobWeb(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.style.display = "none";
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  // Một nhịp microtask giúp một số trình duyệt sẵn sàng
  await Promise.resolve();
  a.click();
  setTimeout(() => {
    try { document.body.removeChild(a); } catch {}
    URL.revokeObjectURL(url);
  }, 1000);
}

// Check quyền WRITE_EXTERNAL_STORAGE (Android < 11 cần, 11+ Scoped Storage tự handle nhưng check không thừa)
async function requestWritePermission() {
  if (typeof window === "undefined" || !window.cordova || !window.cordova.plugins || !window.cordova.plugins.permissions) return true;
  const P = window.cordova.plugins.permissions;
  return new Promise((resolve) => {
    P.checkPermission(P.WRITE_EXTERNAL_STORAGE, (status) => {
      if (status.hasPermission) {
        resolve(true);
      } else {
        P.requestPermission(P.WRITE_EXTERNAL_STORAGE, (s) => resolve(!!s.hasPermission), () => resolve(false));
      }
    }, () => resolve(false));
  });
}

// Ghi tạm vào Cache để có URL cho Share; chỉ move sang Documents khi người dùng đồng ý/chia sẻ
async function writeTempToCache(filename, dataBase64OrUtf8, enc /* "base64"|"utf8" */) {
  const tmpDir = "DienNuocTmp";
  try {
    await Filesystem.mkdir({ path: tmpDir, directory: Directory.Cache, recursive: true })
      .catch(() => {});
  } catch {}
  const tmpPath = `${tmpDir}/${filename}`;
  await Filesystem.writeFile({
    path: tmpPath,
    data: dataBase64OrUtf8,
    directory: Directory.Cache,
    encoding: enc,
    recursive: true,
  });
  const { uri } = await Filesystem.getUri({ path: tmpPath, directory: Directory.Cache });
  return { tmpPath, uri };
}

// Di chuyển (copy + delete) từ Cache sang Documents/DienNuoc
async function moveCacheToDocuments(filename, tmpPath) {
  const dstFolder = "DienNuoc";
  try {
    await Filesystem.mkdir({ path: dstFolder, directory: Directory.Documents, recursive: true })
      .catch(() => {});
  } catch {}
  const dstPath = `${dstFolder}/${filename}`;

  // Capacitor Filesystem thường không move giữa 2 directory ⇒ copy rồi delete
  await Filesystem.copy({
    from: tmpPath,
    to: dstPath,
    directory: Directory.Cache,
    toDirectory: Directory.Documents,
  });
  await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Cache }).catch(() => {});
  const { uri } = await Filesystem.getUri({ path: dstPath, directory: Directory.Documents });
  return { dstPath, uri };
}

function notifySavedDocuments(filename, uri) {
  try {
    alert(`Đã lưu: Tài liệu/ĐiệnNuoc/${filename}\n\nURI: ${uri || "(n/a)"}`);
  } catch {}
}

// ===== public API =====
export async function saveArrayBufferSmart(ab, mime, filename) {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([ab], { type: mime || "application/octet-stream" });
    await downloadBlobWeb(blob, filename);
    return;
  }

  const base64 = abToBase64(ab);
  const Share = getShare();

  if (Share) {
    // 1) Ghi tạm Cache
    await requestWritePermission();
    const { tmpPath, uri } = await writeTempToCache(filename, base64, "base64");
    // 2) Mở Share; nếu người dùng huỷ => xoá file tạm, KHÔNG lưu
    try {
      const res = await Share.share({
        title: filename,
        url: uri,
        dialogTitle: "Chia sẻ / Lưu tệp",
      });
      // Capacitor Share trả về { dismissed?: boolean }
      if (res && res.dismissed) {
        await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Cache }).catch(() => {});
        return; // user cancel => không lưu
      }
      // 3) Người dùng đã thực hiện share (không bị dismissed) => move sang Documents
      const moved = await moveCacheToDocuments(filename, tmpPath);
      notifySavedDocuments(filename, moved.uri);
    } catch {
      // share lỗi/huỷ: xoá file tạm
      await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Cache }).catch(() => {});
    }
    return;
  }

  // Không có Share plugin: hỏi xác nhận, chỉ ghi khi OK
  if (confirm("Lưu tệp vào Tài liệu/ĐiệnNuoc ?")) {
    const moved = await moveCacheToDocuments(filename, (await writeTempToCache(filename, base64, "base64")).tmpPath);
    notifySavedDocuments(filename, moved.uri);
  }
}

export async function saveTextSmart(text, mime, filename) {
  if (!Capacitor.isNativePlatform()) {
    const blob = new Blob([text], { type: mime || "application/octet-stream" });
    await downloadBlobWeb(blob, filename);
    return;
  }

  const Share = getShare();

  if (Share) {
    // Cache → Share → nếu OK thì move Documents, nếu Cancel thì xoá
    await requestWritePermission();
    const { tmpPath, uri } = await writeTempToCache(filename, text, "utf8");
    try {
      const res = await Share.share({
        title: filename,
        url: uri,
        dialogTitle: "Chia sẻ / Lưu tệp",
      });
      if (res && res.dismissed) {
        await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Cache }).catch(() => {});
        return; // cancel => không lưu
      }
      const moved = await moveCacheToDocuments(filename, tmpPath);
      notifySavedDocuments(filename, moved.uri);
    } catch {
      await Filesystem.deleteFile({ path: tmpPath, directory: Directory.Cache }).catch(() => {});
    }
    return;
  }

  // Không có Share: hỏi trước khi ghi
  if (confirm("Lưu tệp vào Tài liệu/ĐiệnNuoc ?")) {
    const moved = await moveCacheToDocuments(filename, (await writeTempToCache(filename, text, "utf8")).tmpPath);
    notifySavedDocuments(filename, moved.uri);
  }
}

export async function saveBlobSmart(blob, filename) {
  const ab = await blob.arrayBuffer();
  const mime = blob.type || "application/octet-stream";
  await saveArrayBufferSmart(ab, mime, filename);
}
