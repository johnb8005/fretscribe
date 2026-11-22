import { useEffect, useRef } from "react";
import type { StyleDef } from "../arranger/types";
import type { Conductor } from "../conductor";
import { PATCH_BY_ID } from "../synth/patches";
import { ROLE_NAMES, SECTIONS, isSoloSeat, sectionsFor, type Section } from "./sections";

const W = 1160;
const H = 640;
const PX = W / 2;
const PY = 612;

const pt = (r: number, deg: number): [number, number] => {
  const a = (deg * Math.PI) / 180;
  return [PX + r * Math.sin(a), PY - r * Math.cos(a)];
};

function wedge(s: Section) {
  const [x0, y0] = pt(s.r0, s.a0);
  const [x1, y1] = pt(s.r1, s.a0);
  const [x2, y2] = pt(s.r1, s.a1);
  const [x3, y3] = pt(s.r0, s.a1);
  const large = s.a1 - s.a0 > 180 ? 1 : 0;
  return `M${x0},${y0} L${x1},${y1} A${s.r1},${s.r1} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${s.r0},${s.r0} 0 ${large} 0 ${x0},${y0} Z`;
}

/** Chairs laid out in arcs inside the wedge. */
function chairs(s: Section, count = s.chairs): [number, number][] {
  if (count !== s.chairs) {
    // Soloists: one chair each, in a row across the middle of the section.
    const r = s.r0 + (s.r1 - s.r0) * 0.82;
    return Array.from({ length: count }, (_, k) => pt(r, s.a0 + ((k + 1) * (s.a1 - s.a0)) / (count + 1)));
  }
  const rows = Math.max(1, Math.min(4, Math.floor((s.r1 - s.r0) / 30)));
  const out: [number, number][] = [];
  const radii = Array.from({ length: rows }, (_, i) => s.r0 + ((i + 0.5) * (s.r1 - s.r0)) / rows);
  const lens = radii.map((r) => r * ((s.a1 - s.a0) * Math.PI) / 180);
  const total = lens.reduce((a, b) => a + b, 0);
  let left = s.chairs;
  radii.forEach((r, i) => {
    const n = i === rows - 1 ? left : Math.max(1, Math.round((s.chairs * lens[i]) / total));
    left -= n;
    for (let k = 0; k < n; k++) {
      const pad = (s.a1 - s.a0) * 0.12;
      const a = n === 1 ? (s.a0 + s.a1) / 2 : s.a0 + pad + (k * (s.a1 - s.a0 - 2 * pad)) / (n - 1);
      out.push(pt(r, a));
    }
  });
  return out.slice(0, s.chairs);
}

/**
 * The orchestra from above. Sections light up while they play (brighter when
 * louder); seats the current ensemble doesn't use stay ghosted. Click a
 * section to mute or unmute it.
 */
export function StageView({ conductor, style, onChange }: { conductor: Conductor | null; style: StyleDef; onChange: () => void }) {
  const glow = useRef(new Map<string, SVGPathElement>());
  const seats = useRef(new Map<string, SVGGElement>());

  // Which parts sit in which section, with the instruments actually assigned.
  const cast = (() => {
    const m = new Map<string, { partIds: string[]; names: Set<string> }>();
    for (const spec of style.parts) {
      const patch = conductor?.patchFor(spec) ?? spec.patch;
      for (const sec of sectionsFor(spec, patch)) {
        const e = m.get(sec) ?? { partIds: [], names: new Set<string>() };
        e.partIds.push(spec.id);
        e.names.add(spec.label);
        m.set(sec, e);
      }
    }
    return m;
  })();
  const castRef = useRef(cast);
  castRef.current = cast;

  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const act = conductor?.activity() ?? new Map<string, number>();
      for (const s of SECTIONS) {
        const c = castRef.current.get(s.id);
        let v = 0;
        for (const id of c?.partIds ?? []) v = Math.max(v, act.get(id) ?? 0);
        const g = glow.current.get(s.id);
        if (g) g.style.opacity = String(Math.min(0.85, v * 0.9));
        const seat = seats.current.get(s.id);
        if (seat) seat.dataset.on = v > 0 ? "1" : "";
      }
    };
    loop();
    return () => cancelAnimationFrame(raf);
  }, [conductor]);

  const toggleMute = (secId: string) => {
    const c = cast.get(secId);
    if (!c || !conductor) return;
    const specs = style.parts.filter((p) => c.partIds.includes(p.id));
    const allMuted = specs.every((p) => conductor.channelFor(p).mute);
    specs.forEach((p) => conductor.setChannel(p, { mute: !allMuted }));
    onChange();
  };

  return (
    <div className="overflow-hidden rounded-lg bg-[#17120f] shadow-[0_12px_30px_-12px_rgba(0,0,0,0.6)]">
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="group" aria-label="Orchestra seating plan">
        <defs>
          <radialGradient id="floor" cx="50%" cy="100%" r="95%">
            <stop offset="0" stopColor="#3a2c22" />
            <stop offset="1" stopColor="#1d1714" />
          </radialGradient>
        </defs>
        <path d={`M${PX - 600},${PY} A600,600 0 0 1 ${PX + 600},${PY} Z`} fill="url(#floor)" />
        {/* Podium */}
        <rect x={PX - 26} y={PY - 30} width={52} height={22} rx={3} fill="#4a3c31" />
        <text x={PX} y={PY - 14} textAnchor="middle" className="fill-nickel font-gear text-[13px] font-semibold">Podium</text>

        {SECTIONS.map((s) => {
          const c = cast.get(s.id);
          const used = !!c;
          const specs = used ? style.parts.filter((p) => c!.partIds.includes(p.id)) : [];
          const muted = used && conductor ? specs.every((p) => conductor.channelFor(p).mute) : false;
          const mid = (s.a0 + s.a1) / 2;
          const [lx, ly] = pt((s.r0 + s.r1) / 2, mid);
          const soloists = specs.filter((p) => isSoloSeat(p.id));
          const title = soloists.length ? soloists.map((p) => p.label).join(" & ") : s.label;
          const subtitle = muted ? "Muted" : soloists.length ? [...new Set(soloists.map((p) => ROLE_NAMES[p.role] ?? p.role))].join(", ") : [...(c?.names ?? [])].join(", ");
          const instruments = used ? [...new Set(specs.map((p) => PATCH_BY_ID[conductor?.patchFor(p) ?? p.patch]?.name ?? ""))].join(", ") : "";
          return (
            <g
              key={s.id}
              role={used ? "button" : undefined}
              tabIndex={used ? 0 : undefined}
              aria-pressed={used ? muted : undefined}
              aria-label={used ? `${s.label}: ${[...c!.names].join(", ")}${muted ? ", muted" : ""}. Press to ${muted ? "unmute" : "mute"}.` : undefined}
              onClick={() => used && toggleMute(s.id)}
              onKeyDown={(e) => {
                if (used && (e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  toggleMute(s.id);
                }
              }}
              className={used ? "cursor-pointer outline-none focus-visible:[&>path:first-child]:stroke-lamp" : ""}
              opacity={used ? (muted ? 0.45 : 1) : 0.22}
            >
              <path d={wedge(s)} fill="#2a221d" stroke="#4a3f36" strokeWidth={1.2} />
              <path
                ref={(el) => {
                  if (el) glow.current.set(s.id, el);
                }}
                d={wedge(s)}
                fill="var(--color-lamp)"
                style={{ opacity: 0, transition: "opacity 90ms linear" }}
              />
              <g
                ref={(el) => {
                  if (el) seats.current.set(s.id, el);
                }}
                className="group/seats"
              >
                {chairs(s, soloists.length || s.chairs).map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r={s.chairs > 20 ? 4 : 5.5} className="fill-[#5a4c40] transition-colors duration-75 group-data-[on=1]/seats:fill-bone" />
                ))}
              </g>
              <title>{used ? `${instruments}, playing ${[...c!.names].join(", ").toLowerCase()}` : "Not in this ensemble"}</title>
              <text x={lx} y={ly - (used ? 4 : -5)} textAnchor="middle" className="pointer-events-none fill-bone font-gear text-[17px] font-bold [paint-order:stroke] [stroke:#17120f] [stroke-width:3px]">
                {title}
              </text>
              {used && (
                <text x={lx} y={ly + 13} textAnchor="middle" className="pointer-events-none fill-bone-dim text-[11px] [paint-order:stroke] [stroke:#17120f] [stroke-width:3px]">
                  {subtitle}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
