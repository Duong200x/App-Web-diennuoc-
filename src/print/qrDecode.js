// src/print/qrDecode.js
import jsQR from "jsqr";

async function fileToImageData(file, { maxWidth = 900 } = {}) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res(true);
      img.onerror = (e) => rej(e);
      img.src = url;
    });

    const scale = Math.min(1, maxWidth / img.width);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);

    return ctx.getImageData(0, 0, w, h);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Decode QR từ ảnh (file)
 * Trả về payload string hoặc null
 */
export async function decodeQrFromFile(file) {
  const imgData = await fileToImageData(file, { maxWidth: 900 });
  const code = jsQR(imgData.data, imgData.width, imgData.height, {
    inversionAttempts: "attemptBoth",
  });
  return code?.data || null;
}
