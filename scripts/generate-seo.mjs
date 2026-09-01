import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const configuredOrigin = process.env.VITE_PUBLIC_SITE_URL?.trim();
const strict = process.argv.includes("--strict");
const origin = (configuredOrigin || "http://localhost:5173").replace(/\/$/, "");

if (strict && (!configuredOrigin || !origin.startsWith("https://") || /^https?:\/\/(localhost|127\.0\.0\.1)(?::\d+)?$/i.test(origin))) {
  throw new Error("VITE_PUBLIC_SITE_URL doit contenir l'origine HTTPS publique pour un build de production.");
}

const routes = [
  "/",
  "/hebergements",
  "/contact",
  "/mentions-legales",
];

const robots = `User-agent: *
Allow: /
Disallow: /admin/

Sitemap: ${origin}/sitemap.xml
`;

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${routes.map((route) => `  <url><loc>${origin}${route}</loc></url>`).join("\n")}
</urlset>
`;

await Promise.all([
  writeFile(resolve("public", "robots.txt"), robots, "utf8"),
  writeFile(resolve("public", "sitemap.xml"), sitemap, "utf8"),
]);

console.info(`SEO files generated for ${origin}`);
