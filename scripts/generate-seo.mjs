import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadEnv } from "vite";

const buildEnv = { ...loadEnv("production", process.cwd(), ""), ...process.env };
const configuredOrigin = buildEnv.VITE_PUBLIC_SITE_URL?.trim();
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
  return (buildEnv.VITE_PUBLIC_ROOM_SLUGS ?? "")
    .split(",")
    .map((slug) => slug.trim())
    .filter((slug) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
}

function externalApiBase() {
  const apiBase = buildEnv.VITE_API_URL?.trim();
  return apiBase && !apiBase.startsWith("/") ? apiBase.replace(/\/$/, "") : null;
}

async function fetchApiData(apiBase, path) {
  const response = await fetch(`${apiBase}${path}`, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) throw new Error(`L'API a répondu HTTP ${response.status} pour ${path}.`);
  const body = await response.json();
  if (!body || typeof body !== "object" || !("data" in body)) throw new Error(`La réponse de l'API est invalide pour ${path}.`);
  return body.data;
}

const apiBase = externalApiBase();
const configuredSlugs = configuredRoomSlugs();
const configuredPropertyName = buildEnv.VITE_PUBLIC_PROPERTY_NAME?.trim();
const configuredPropertyCity = buildEnv.VITE_PUBLIC_PROPERTY_CITY?.trim();
let property = null;
let roomSlugs = null;
let roomSlugSource = "none";

if (apiBase) {
  const [propertyResult, roomTypesResult] = await Promise.allSettled([
    fetchApiData(apiBase, "/property"),
    fetchApiData(apiBase, "/room-types"),
  ]);

  if (propertyResult.status === "fulfilled" && propertyResult.value && typeof propertyResult.value === "object") {
    property = propertyResult.value;
  } else if (propertyResult.status === "rejected") {
    const message = propertyResult.reason instanceof Error ? propertyResult.reason.message : String(propertyResult.reason);
    if (strict && !configuredPropertyName) throw new Error(`Impossible de générer les métadonnées de l'établissement : ${message}`);
    console.warn(`Métadonnées établissement indisponibles via l'API, utilisation du fallback : ${message}`);
  }

  if (roomTypesResult.status === "fulfilled" && Array.isArray(roomTypesResult.value)) {
    roomSlugs = roomTypesResult.value
      .map((roomType) => roomType?.slug)
      .filter((slug) => typeof slug === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug));
    roomSlugSource = "api";
  } else {
    const message = roomTypesResult.status === "rejected"
      ? (roomTypesResult.reason instanceof Error ? roomTypesResult.reason.message : String(roomTypesResult.reason))
      : "La liste des hébergements est invalide.";
    if (strict && !configuredSlugs.length) throw new Error(`Impossible de générer le sitemap détaillé : ${message}`);
    console.warn(`Catalogue indisponible via l'API, utilisation du fallback : ${message}`);
  }
}

if (roomSlugs === null && configuredSlugs.length) roomSlugSource = "env";
roomSlugs = [...new Set(roomSlugs ?? configuredSlugs)];
const apiPropertyName = typeof property?.name === "string" && property.name.trim() ? property.name.trim() : null;
const propertyName = apiPropertyName
  ? apiPropertyName
  : configuredPropertyName || "Établissement";
const propertyCity = typeof property?.city === "string" && property.city.trim()
  ? property.city.trim()
  : configuredPropertyCity || "";
if (strict && propertyName === "Établissement") {
  throw new Error("VITE_PUBLIC_PROPERTY_NAME est requis lorsque l'API publique n'est pas accessible pendant le build.");
}

const cityPhrase = propertyCity ? ` à ${propertyCity}` : "";
const title = `${propertyName} | Séjour${cityPhrase}`;
const description = buildEnv.VITE_PUBLIC_META_DESCRIPTION?.trim()
  || `${propertyName}${cityPhrase} : découvrez les hébergements, services et disponibilités de l'établissement.`;
const configuredSocialImage = buildEnv.VITE_PUBLIC_SOCIAL_IMAGE?.trim() || "/images/hotel/hero-1280.webp";
const socialImage = new URL(configuredSocialImage, `${origin}/`).href;
const propertySource = apiPropertyName ? "api" : configuredPropertyName ? "env" : "default";

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
  mkdir(resolve(".generated"), { recursive: true }).then(() => writeFile(
    resolve(".generated", "seo-manifest.json"),
    `${JSON.stringify({ propertyName, propertyCity, title, description, socialImage, propertySource, roomSlugs, roomSlugSource }, null, 2)}\n`,
    "utf8",
  )),
]);

console.info(`SEO files generated for ${origin} (${roomSlugs.length} hébergement(s), ${propertyName})`);
