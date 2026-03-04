// vite.config.js
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => {
  const isApk = mode === "apk";

  return {
    resolve: {
      alias: {
        ...(isApk ? {
          "virtual:pwa-register": "/src/pwa-shim.js",
          "@capacitor/share": "/src/shims/capacitor-share.js",   // <<-- QUAN TRỌNG
        } : {})
      }
    },

    base: isApk ? "./" : "/",

    build: {
      chunkSizeWarningLimit: 2048,
      rollupOptions: {
        output: {
          manualChunks: {
            firebase: ["firebase/app","firebase/firestore"],
            xlsx: ["xlsx"],
            docx: ["docx"],
            capacitor: [
              "@capacitor/core",
              "@capacitor/filesystem",
              "@capacitor/status-bar",
              // KHÔNG để "@capacitor/share" ở đây
            ],
          },
        },
      },
    },

    plugins: [
      ...(isApk ? [] : [
        VitePWA({
          registerType: "autoUpdate",
          devOptions: { enabled: true },
          includeAssets: ["/icons/5.png","/icons/6.png","/icons/7.png","/favicon.ico"],
          workbox: {
            globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,webmanifest}"],
            maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
          },
          manifest: { /* giữ nguyên như bạn đang dùng */ }
        }),
      ]),
    ],
  };
});
