import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(normalized)) return "react-vendor";
          if (normalized.includes("/src/admin/") || normalized.endsWith("/src/api/admin.ts")) return "admin-core";
          return undefined;
        },
      },
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
