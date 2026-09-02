import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const configuredOrigin = process.env.VITE_PUBLIC_SITE_URL?.trim();
const strict = process.argv.includes("--strict");
let siteUrl;

try {
  siteUrl = new URL(configuredOrigin || "http://localhost:5173");
} catch {
  throw new Error("VITE_PUBLIC_SITE_URL doit être une URL absolue valide.");
}

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
const isPureOrigin = siteUrl.pathname === "/"
  && !siteUrl.search
  && !siteUrl.hash
  && !siteUrl.username
  && !siteUrl.password;

if (strict && (!configuredOrigin || siteUrl.protocol !== "https:" || localHosts.has(siteUrl.hostname) || !isPureOrigin)) {
  throw new Error("VITE_PUBLIC_SITE_URL doit contenir une origine HTTPS publique sans chemin, paramètres ni identifiants.");
}

const origin = siteUrl.origin;

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
