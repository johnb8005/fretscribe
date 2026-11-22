import { useRef } from "react";

// Amp-style rotary knob: drag up/down, scroll, or use the arrow keys.
export function Knob({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  defaultValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  defaultValue: number;
}) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const t = (value - min) / (max - min);
  const angle = -135 + t * 270;
  const R = 17;
  const arc = (from: number, to: number) => {
    const p = (a: number) => {
      const r = ((a - 90) * Math.PI) / 180;
      return `${22 + R * Math.cos(r)} ${22 + R * Math.sin(r)}`;
    };
    return `M ${p(from)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${p(to)}`;
  };

  return (
    <div className="flex items-center gap-2.5">
      <div
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        title={`${label}: ${format(value)} (drag, scroll or use arrow keys; double-click to reset)`}
        className="size-11 cursor-ns-resize touch-none rounded-full"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, v: value };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          const dy = drag.current.y - e.clientY;
          onChange(clamp(drag.current.v + (dy / 160) * (max - min)));
        }}
        onPointerUp={() => (drag.current = null)}
        onDoubleClick={() => onChange(defaultValue)}
        onWheel={(e) => onChange(clamp(value - Math.sign(e.deltaY) * step * 2))}
        onKeyDown={(e) => {
          const big = (max - min) / 10;
          const map: Record<string, number> = {
            ArrowUp: step, ArrowRight: step, ArrowDown: -step, ArrowLeft: -step, PageUp: big, PageDown: -big,
          };
          if (e.key in map) {
            e.preventDefault();
            onChange(clamp(value + map[e.key]));
          } else if (e.key === "Home") onChange(min);
          else if (e.key === "End") onChange(max);
        }}
      >
        <svg viewBox="0 0 44 44" className="size-11" aria-hidden>
          <path d={arc(-135, 135)} fill="none" stroke="var(--color-grain)" strokeWidth={3} strokeLinecap="round" />
          {t > 0.005 && <path d={arc(-135, angle)} fill="none" stroke="var(--color-lamp)" strokeWidth={3} strokeLinecap="round" />}
          <circle cx={22} cy={22} r={12} fill="#1a1512" stroke="var(--color-grain)" />
          <line
            x1={22}
            y1={22}
            x2={22}
            y2={12.5}
            stroke="var(--color-bone)"
            strokeWidth={2.2}
            strokeLinecap="round"
            transform={`rotate(${angle} 22 22)`}
          />
        </svg>
      </div>
      <div className="leading-tight">
        <div className="font-gear text-[15px] font-semibold text-bone">{label}</div>
        <div className="text-xs text-nickel">{format(value)}</div>
      </div>
    </div>
  );
}

// Stomp-box footswitch with a jewel lamp.
export function Footswitch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className="group flex items-center gap-3 rounded-full py-1 pr-4 pl-1 hover:bg-ebony"
    >
      <span className="relative grid size-11 place-items-center rounded-full bg-[radial-gradient(circle_at_35%_30%,#e7e2d8,#8c8579_60%,#4a443d)] shadow-[inset_0_-2px_3px_rgba(0,0,0,0.45),0_2px_6px_rgba(0,0,0,0.5)] transition-transform group-active:scale-95">
        <span className="size-6 rounded-full bg-[radial-gradient(circle_at_40%_35%,#cfc9bf,#7a746b)]" />
        <span
          className={`absolute -top-0.5 -right-0.5 size-3 rounded-full border border-ink ${
            on ? "bg-lamp shadow-[0_0_10px_2px_var(--color-lamp)]" : "bg-[#5a2a1e]"
          }`}
        />
      </span>
      <span className="font-gear text-xl font-semibold text-bone">{on ? "Stop" : "Listen"}</span>
    </button>
  );
}
