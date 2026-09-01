import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const variants = [
  { width: 768, quality: 48 },
  { width: 1280, quality: 54 },
  { width: 1920, quality: 58 },
];

for (const variant of variants) {
  const source = resolve("public", "images", "hotel", `hero-${variant.width}.webp`);
  const destination = resolve("public", "images", "hotel", `hero-${variant.width}.avif`);
  await sharp(source)
    .avif({ quality: variant.quality, effort: 6, chromaSubsampling: "4:2:0" })
    .toFile(destination);
  const output = await stat(destination);
  console.info(`hero-${variant.width}.avif: ${Math.round(output.size / 1024)} KiB`);
}
