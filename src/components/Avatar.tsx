// Circles avatar image. `src` is the profile's previewImageUrl — usually a
// data: URI, so next/image isn't applicable; a plain <img> is correct here.
// Falls back to a neutral circle when no image is available.
export default function Avatar({
  src,
  alt,
  size = 32,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  if (!src) {
    return (
      <div
        className="shrink-0 rounded-full bg-neutral-800"
        style={{ width: size, height: size }}
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="shrink-0 rounded-full object-cover"
      style={{ width: size, height: size }}
    />
  );
}
