import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const origin = (process.env.VITE_PUBLIC_SITE_URL || "http://localhost:5173").replace(/\/$/, "");
const routes = [
  "/",
  "/hebergements",
  "/hebergements/chambre-classique",
  "/hebergements/chambre-elegance",
  "/hebergements/chambre-deluxe",
  "/hebergements/suite-rivage",
  "/contact",
  "/mentions-legales",
];

const robots = `User-agent: *
Allow: /
Disallow: /admin/
Disallow: /reservation
Disallow: /confirmation

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
