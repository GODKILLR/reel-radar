/** Star Labs mark: coral five-point star in a white circle, plus wordmark. */
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
  return (
    <span className="inline-flex items-center gap-2">
      <StarMark size={size} />
      <span
        className="text-[22px] font-extrabold leading-none tracking-tight"
        style={{ color: onDark ? "#fff" : "var(--ink)" }}
      >
        Star <span style={{ color: "var(--accent)" }}>Labs</span>
      </span>
    </span>
  );
}
