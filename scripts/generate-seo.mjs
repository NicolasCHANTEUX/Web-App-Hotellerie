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

function configuredRoomSlugs() {
  return (process.env.VITE_PUBLIC_ROOM_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
}

async function publishedRoomSlugs() {
  const configured = configuredRoomSlugs();
  if (configured.length) return configured;

  const apiBase = process.env.VITE_API_URL?.trim();
  if (!apiBase || apiBase.startsWith("/")) return [];
  const response = await fetch(`${apiBase.replace(/\/$/, "")}/room-types`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`L'API catalogue a répondu HTTP ${response.status}.`);
  const body = await response.json();
  if (!body || !Array.isArray(body.data)) throw new Error("La réponse de l'API catalogue est invalide.");
  return body.data
    .map((roomType) => roomType?.slug)
    .filter((slug) => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
}

let roomSlugs = [];
try {
  roomSlugs = await publishedRoomSlugs();
} catch (error) {
  if (strict) throw error;
  console.warn(`Les hébergements n'ont pas été ajoutés au sitemap : ${error instanceof Error ? error.message : error}`);
}

const routes = [
  "/",
  "/hebergements",
  "/contact",
  "/mentions-legales",
  ...roomSlugs.map((slug) => `/hebergements/${encodeURIComponent(slug)}`),
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
