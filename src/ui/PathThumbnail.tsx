import { BASKETS, HIVE_RECT, observationZone, netZone } from "../config/field";

const f = (v: number) => (v / 144) * 100;
const fy = (v: number) => 100 - (v / 144) * 100;

/** Mini field map for repository cards. `points` is the normalised "x,y x,y" thumbnail string. */
export function PathThumbnail({ points, alliance = "red", className }: { points: string; alliance?: "red" | "blue"; className?: string }) {
  const color = alliance === "red" ? "#ff5a5f" : "#5b8cff";
  const first = points.split(" ")[0]?.split(",").map(Number);
  const pts = points.split(" ");
  const last = pts[pts.length - 1]?.split(",").map(Number);
  const tri = (a: "red" | "blue") => netZone(a).map((p) => `${f(p.x)},${fy(p.y)}`).join(" ");
  return (
    <svg viewBox="-2 -2 104 104" className={className} aria-hidden>
      <rect x="-2" y="-2" width="104" height="104" rx="6" fill="#0d0e11" />
      <rect x="0" y="0" width="100" height="100" fill="#1b1d21" />
      {[1, 2, 3, 4, 5].map((i) => (
        <g key={i} stroke="#24272c" strokeWidth="0.4">
          <line x1={(i * 100) / 6} y1="0" x2={(i * 100) / 6} y2="100" />
          <line x1="0" y1={(i * 100) / 6} x2="100" y2={(i * 100) / 6} />
        </g>
      ))}
      <polygon points={tri("red")} fill="rgba(229,56,59,0.25)" />
      <polygon points={tri("blue")} fill="rgba(47,111,237,0.25)" />
      {(["red", "blue"] as const).map((a) => {
        const o = observationZone(a);
        return <rect key={a} x={f(o.minX)} y={fy(o.maxY)} width={f(o.maxX - o.minX)} height={f(o.maxY - o.minY)} fill="none" stroke={a === "red" ? "#e5383b" : "#2f6fed"} strokeWidth="0.6" opacity="0.7" />;
      })}
      <rect x={f(HIVE_RECT.minX)} y={fy(HIVE_RECT.maxY)} width={f(HIVE_RECT.maxX - HIVE_RECT.minX)} height={f(HIVE_RECT.maxY - HIVE_RECT.minY)} fill="rgba(34,211,238,0.08)" stroke="#5b6470" strokeWidth="0.8" />
      {BASKETS.filter((b) => b.level === "high").map((b) => (
        <rect key={b.id} x={f(b.x) - 3} y={fy(b.y) - 3} width="6" height="6" fill="none" stroke={b.alliance === "red" ? "#e5383b" : "#2f6fed"} strokeWidth="0.8" />
      ))}
      <polyline points={points} fill="none" stroke={color} strokeWidth="5" strokeOpacity="0.18" strokeLinejoin="round" strokeLinecap="round" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {first && <circle cx={first[0]} cy={first[1]} r="2.4" fill="#0d0e11" stroke={color} strokeWidth="1.2" />}
      {last && <circle cx={last[0]} cy={last[1]} r="1.8" fill={color} />}
    </svg>
  );
}
