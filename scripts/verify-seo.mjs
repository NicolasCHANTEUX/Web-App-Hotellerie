import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";

const buildEnv = { ...loadEnv("production", process.cwd(), ""), ...process.env };

const [indexHtml, robots, sitemap, manifestText] = await Promise.all([
  readFile(resolve("dist", "index.html"), "utf8"),
  readFile(resolve("dist", "robots.txt"), "utf8"),
  readFile(resolve("dist", "sitemap.xml"), "utf8"),
  readFile(resolve(".generated", "seo-manifest.json"), "utf8"),
]);
const manifest = JSON.parse(manifestText);

function expectedRoomSlugs() {
  return (buildEnv.VITE_PUBLIC_ROOM_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter(Boolean);
}

const sitemapOrigin = buildEnv.VITE_PUBLIC_SITE_URL?.replace(/\/$/, "")
  || sitemap.match(/<loc>(https?:\/\/[^/]+)\//)?.[1];
if (!sitemapOrigin) throw new Error("L'origine publique est absente du sitemap généré.");

for (const route of ["/", "/hebergements", "/contact", "/mentions-legales"]) {
  if (!sitemap.includes(`<loc>${sitemapOrigin}${route}</loc>`)) {
    throw new Error(`La route ${route} est absente du sitemap généré.`);
  }
}

const generatedRoomSlugs = Array.isArray(manifest.roomSlugs) ? manifest.roomSlugs : [];
for (const slug of generatedRoomSlugs) {
  if (!sitemap.includes(`/hebergements/${slug}</loc>`)) {
    throw new Error(`L'hébergement ${slug} est absent du sitemap généré.`);
  }
}
if (manifest.roomSlugSource !== "api") {
  for (const slug of expectedRoomSlugs()) {
    if (!generatedRoomSlugs.includes(slug)) {
      throw new Error(`Le fallback d'hébergement ${slug} n'a pas été généré.`);
    }
  }
}

if (sitemap.includes("/admin") || !robots.includes("Disallow: /admin/")) {
  throw new Error("Les règles SEO de l'administration sont invalides.");
}
if (indexHtml.includes("__SEO_")) {
  throw new Error("Le HTML de production contient encore un placeholder SEO.");
}

const expectedMetadata = [
  manifest.propertyName,
  manifest.description,
  manifest.socialImage,
].filter(Boolean);
for (const value of expectedMetadata) {
  if (!indexHtml.includes(value)) {
    throw new Error(`La métadonnée de build attendue est absente de index.html : ${value}`);
  }
}

console.info(JSON.stringify({
  seoVerified: true,
  roomRoutes: generatedRoomSlugs.length,
  staticMetadata: expectedMetadata.length,
}));
