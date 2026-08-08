import { ChevronLeft, ChevronRight, X } from "lucide-react";

type Props = {
  images: string[];
  index: number | null;
  alt: string;
  onClose: () => void;
  onChange: (index: number) => void;
};

export function Lightbox({ images, index, alt, onClose, onChange }: Props) {
  if (index === null) return null;
  const next = () => onChange((index + 1) % images.length);
  const previous = () => onChange((index - 1 + images.length) % images.length);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-brown-950/92 p-4" role="dialog" aria-modal="true">
      <button className="icon-button absolute right-5 top-5 bg-ivory" onClick={onClose} aria-label="Fermer">
        <X size={22} />
      </button>
      <button className="lightbox-nav left-4" onClick={previous} aria-label="Image precedente">
        <ChevronLeft />
      </button>
      <img src={images[index]} alt={alt} className="max-h-[82vh] w-full max-w-5xl object-contain" />
      <button className="lightbox-nav right-4" onClick={next} aria-label="Image suivante">
        <ChevronRight />
      </button>
    </div>
  );
}
