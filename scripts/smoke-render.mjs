import { Window } from "happy-dom";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const window = new Window({ url: "http://localhost:5173/" });
window.document.body.innerHTML = '<div id="root"></div>';

const browserGlobals = {
  window,
  document: window.document,
  navigator: window.navigator,
  location: window.location,
  history: window.history,
  HTMLElement: window.HTMLElement,
  HTMLFormElement: window.HTMLFormElement,
  Node: window.Node,
  MutationObserver: window.MutationObserver,
  requestAnimationFrame: window.requestAnimationFrame.bind(window),
  cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
};

for (const [name, value] of Object.entries(browserGlobals)) {
  Object.defineProperty(globalThis, name, { configurable: true, value, writable: true });
}

globalThis.fetch = async (input) => {
  if (String(input).endsWith("/api/property")) {
    return new Response(JSON.stringify({ data: {
      slug: "hotel-rivage",
      name: "Hôtel Rivage",
      email: "contact@hotel-rivage.fr",
      phone: "+33 4 93 00 12 34",
      addressLine1: "26 avenue des Pins",
      addressLine2: null,
      postalCode: "06400",
      city: "Cannes",
      countryCode: "FR",
      timezone: "Europe/Paris",
      checkInTime: "15:00",
      checkOutTime: "11:00",
      roomCount: 18,
    } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { "content-type": "application/json" } });
};

const assetsDirectory = resolve("dist", "assets");
const bundle = (await readdir(assetsDirectory)).find((file) => /^index-.*\.js$/.test(file));
if (!bundle) throw new Error("Frontend bundle not found.");

await import(pathToFileURL(resolve(assetsDirectory, bundle)).href);
await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));

const root = window.document.getElementById("root");
const text = root?.textContent?.trim() ?? "";
if (!root?.children.length || !text.includes("Rivage")) {
  throw new Error(`React rendered no usable content. Root text: ${text.slice(0, 160)}`);
}

const structuredData = window.document.querySelector("#hotel-structured-data")?.textContent;
if (!structuredData || JSON.parse(structuredData)["@type"] !== "Hotel") {
  throw new Error("Hotel structured data was not rendered.");
}

const [robots, sitemap] = await Promise.all([
  readFile(resolve("dist", "robots.txt"), "utf8"),
  readFile(resolve("dist", "sitemap.xml"), "utf8"),
]);
if (!robots.includes("Disallow: /admin/") || !robots.includes("Sitemap:")) {
  throw new Error("robots.txt is incomplete.");
}
if (!sitemap.includes("/hebergements</loc>") || sitemap.includes("/admin")) {
  throw new Error("sitemap.xml contains invalid routes.");
}

console.log(JSON.stringify({ rendered: true, childElements: root.children.length, textLength: text.length, seo: true }));
window.close();
