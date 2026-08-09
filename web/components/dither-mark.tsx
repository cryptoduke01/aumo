// The vault mark as a dithered (Floyd-Steinberg) stipple. Uses the PNG as a CSS
// mask over currentColor, so the stipple themes with the text colour instead of
// being locked to one shade. Decorative.
export function DitherMark({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        WebkitMaskImage: "url(/brand/mark-dither.png)",
        maskImage: "url(/brand/mark-dither.png)",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        backgroundColor: "currentColor",
      }}
    />
  );
}
