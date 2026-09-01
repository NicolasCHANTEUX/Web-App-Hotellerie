import type { ImgHTMLAttributes } from "react";

const DEFAULT_WIDTHS = [480, 768, 1200, 1600];

function unsplashSourceSet(src: string, widths: number[]) {
  try {
    const url = new URL(src);
    if (url.hostname !== "images.unsplash.com") return undefined;
    return widths.map((width) => {
      const candidate = new URL(url);
      candidate.searchParams.set("auto", "format");
      candidate.searchParams.set("fit", "crop");
      candidate.searchParams.set("w", String(width));
      candidate.searchParams.set("q", width >= 1200 ? "80" : "76");
      return `${candidate.toString()} ${width}w`;
    }).join(", ");
  } catch {
    return undefined;
  }
}

export function ResponsiveImage({
  avifSrcSet,
  priority = false,
  responsiveWidths = DEFAULT_WIDTHS,
  sizes = "100vw",
  src,
  srcSet,
  ...props
}: ImgHTMLAttributes<HTMLImageElement> & {
  avifSrcSet?: string;
  priority?: boolean;
  responsiveWidths?: number[];
}) {
  const generatedSourceSet = srcSet ?? (typeof src === "string" ? unsplashSourceSet(src, responsiveWidths) : undefined);
  const image = <img
    {...props}
    src={src}
    srcSet={generatedSourceSet}
    sizes={generatedSourceSet ? sizes : undefined}
    loading={priority ? "eager" : props.loading ?? "lazy"}
    decoding={priority ? "sync" : props.decoding ?? "async"}
    fetchPriority={priority ? "high" : props.fetchPriority ?? "auto"}
  />;
  return avifSrcSet
    ? <picture><source type="image/avif" srcSet={avifSrcSet} sizes={sizes} />{image}</picture>
    : image;
}
