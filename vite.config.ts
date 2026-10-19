import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

// The Express API runs on :8787 in local dev; Vite proxies /api to it so the
// browser talks to a single origin (cookies + fetch "just work"). In production
// on Vercel, /api is served by the serverless function (see vercel.json).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8787",
        changeOrigin: true,
        // Forward the browser's host so API-built URLs (images) stay same-origin.
        xfwd: true,
      },
    },
  },
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // Long-lived vendor chunks: app deploys don't invalidate these in the browser cache.
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          motion: ["framer-motion"],
        },
      },
    },
  },
});
