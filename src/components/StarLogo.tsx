/** Star Labs logo (the official wordmark). Files live in public/brand/. */
export const STAR_LABS_SITE = "https://starlabsstudio.com/";
export const STAR_LABS_INSTAGRAM = "https://www.instagram.com/starlabs.ai/";

function starPoints(cx: number, cy: number, outer: number, inner: number) {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = ((-90 + i * 36) * Math.PI) / 180;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + r * Math.cos(angle)).toFixed(2)},${(cy + r * Math.sin(angle)).toFixed(2)}`);
  }
  return pts.join(" ");
}

const STAR = starPoints(20, 20.5, 11, 4.6);

/** Small round star badge, kept for places that need a compact mark. */
export function StarMark({ size = 36 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      aria-hidden
      className="shrink-0"
    >
      <circle cx="20" cy="20" r="18" fill="#fff" stroke="#10182a" strokeWidth="2.5" />
      <polygon points={STAR} fill="#e2533b" stroke="#10182a" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

export default function StarLogo({
  size = 36,
  onDark = false,
}: {
  size?: number;
  onDark?: boolean;
}) {
  // The logo is ~1.73x wider than tall; `size` keeps its old meaning (roughly the
  // height of the mark), so the image is a little taller than that.
  const height = Math.round(size * 1.25);
  const width = Math.round(height * 1.726);
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={onDark ? "/brand/logo-white.png" : "/brand/logo-dark.png"}
      alt="Star Labs"
      width={width}
      height={height}
      className="shrink-0"
      style={{ height, width: "auto" }}
    />
  );
}
