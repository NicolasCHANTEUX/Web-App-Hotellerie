import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { visualizer } from "rollup-plugin-visualizer";

const defaultSeo = {
  propertyName: "Établissement",
  title: "Séjour à l'hôtel",
  description: "Découvrez nos hébergements, nos services et nos disponibilités.",
  socialImage: "/images/hotel/hero-1280.webp",
};

function generatedSeo() {
  try {
    return { ...defaultSeo, ...JSON.parse(readFileSync(resolve(".generated", "seo-manifest.json"), "utf8")) };
  } catch {
    return defaultSeo;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function seoHtmlPlugin(metadata) {
  const replacements = {
    "__SEO_PROPERTY_NAME__": metadata.propertyName,
    "__SEO_TITLE__": metadata.title,
    "__SEO_DESCRIPTION__": metadata.description,
    "__SEO_SOCIAL_IMAGE__": metadata.socialImage,
  };
  return {
    name: "hotel-build-seo",
    transformIndexHtml(html) {
      return Object.entries(replacements).reduce(
        (result, [token, value]) => result.replaceAll(token, escapeHtml(value)),
        html,
      );
    },
  };
}

export default defineConfig(({ command, mode }) => ({
  plugins: [
    seoHtmlPlugin(command === "build" ? generatedSeo() : defaultSeo),
    react(),
    tailwindcss(),
    ...(mode === "analyze" ? [visualizer({ filename: "dist/bundle-report.html", gzipSize: true, brotliSize: true })] : []),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (/node_modules\/(react|react-dom|react-router|react-router-dom)\//.test(normalized)) return "react-vendor";
          if (normalized.includes("/node_modules/lucide-react/")) return "icons";
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
}));
