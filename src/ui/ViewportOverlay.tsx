import { useEffect, useState } from "react";
import { OPPONENTS, type OpponentId } from "../path/presets";
import { bus } from "../sim/bus";
import { useApp, type CameraMode } from "../store/app";
import { IconCamera } from "./icons";
import { Kbd, Segmented, cx, usePoll } from "./primitives";

const CAMERAS: { value: CameraMode; label: string }[] = [
  { value: "broadcast", label: "Broadcast" },
  { value: "top", label: "Top" },
  { value: "driver", label: "Driver" },
  { value: "follow", label: "Chase" },
];

function Toggles() {
  const show = useApp((s) => s.show);
  const toggle = useApp((s) => s.toggleShow);
  const items: { k: keyof typeof show; label: string }[] = [
    { k: "path", label: "Path" },
    { k: "trail", label: "Trail" },
    { k: "ghost", label: "Ghost" },
    { k: "markers", label: "Advocate" },
    { k: "opponentPath", label: "Opp. path" },
  ];
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((i) => (
        <button
          key={i.k}
          onClick={() => toggle(i.k)}
          aria-pressed={show[i.k]}
          className={cx(
            "h-6 rounded-md px-2 text-[11px] font-medium transition-colors hairline",
            show[i.k] ? "bg-white/[0.08] text-fg" : "bg-ink-900/70 text-dim hover:text-muted",
          )}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

function ProgressStrip() {
  const compiled = useApp((s) => s.compiled);
  const runState = useApp((s) => s.runState);
  const t = usePoll(() => ({ time: bus.simTime, chain: bus.telemetry.chain, phase: bus.telemetry.phase }), 12);
  if (!compiled) return null;
  const total = Math.max(compiled.duration, 30);
  return (
    <div className="w-full max-w-[560px] rounded-xl bg-ink-950/75 px-3 py-2 backdrop-blur-md hairline">
      <div className="mb-1.5 flex items-center justify-between text-[10.5px] text-muted">
        <span className="mr-3 truncate font-medium text-fg/90">{compiled.spec.name}</span>
        <span className="font-mono tabular">
          {t.time.toFixed(1)}s <span className="text-dim">/ plan {compiled.duration.toFixed(1)}s</span>
        </span>
      </div>
      <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.05]">
        {compiled.chains.map((c) => (
          <div
            key={c.index}
            className={cx("absolute inset-y-0 border-r border-ink-950", t.chain === c.index && runState === "running" ? "bg-deep/45" : "bg-white/[0.08]")}
            style={{ left: `${(c.startTime / total) * 100}%`, width: `${((c.endTime - c.startTime) / total) * 100}%` }}
          />
        ))}
        <div className="absolute inset-y-0 w-px bg-bad/70" style={{ left: `${(30 / total) * 100}%` }} title="30 s" />
        <div className="absolute inset-y-0 left-0 rounded-full bg-deep shadow-[0_0_8px_rgba(34,211,238,0.8)]" style={{ width: `${Math.min(100, (t.time / total) * 100)}%`, opacity: 0.85 }} />
      </div>
    </div>
  );
}

function DriverHints() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl bg-ink-950/75 px-3 py-2 text-[11px] text-muted backdrop-blur-md hairline">
      <span className="flex items-center gap-1">
        <Kbd>W</Kbd>
        <Kbd>A</Kbd>
        <Kbd>S</Kbd>
        <Kbd>D</Kbd> drive
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Q</Kbd>
        <Kbd>E</Kbd> turn
      </span>
      <span className="flex items-center gap-1">
        <Kbd>⇧</Kbd> precision
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Space</Kbd> intake/drop
      </span>
      <span className="flex items-center gap-1">
        <Kbd>1</Kbd>
        <Kbd>2</Kbd> basket hi/lo
      </span>
      <span className="flex items-center gap-1">
        <Kbd>3</Kbd>
        <Kbd>4</Kbd> chamber hi/lo
      </span>
      <span className="flex items-center gap-1">
        <Kbd>C</Kbd> camera
      </span>
    </div>
  );
}

function Toast() {
  const toast = useApp((s) => s.toast);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2200);
    return () => clearTimeout(id);
  }, [toast]);
  if (!toast || !visible) return null;
  return (
    <div
      key={toast.id}
      role="status"
      className={cx(
        "toast-in pointer-events-none absolute left-1/2 top-14 z-30 -translate-x-1/2 rounded-full px-4 py-1.5 text-[12.5px] font-semibold shadow-xl backdrop-blur-md",
        toast.tone === "good" && "bg-good/15 text-good shadow-[inset_0_0_0_1px_rgba(74,222,128,0.35)]",
        toast.tone === "bad" && "bg-bad/15 text-[#ff8a8a] shadow-[inset_0_0_0_1px_rgba(239,68,68,0.35)]",
        toast.tone === "info" && "bg-ink-800/90 text-fg hairline",
      )}
    >
      {toast.text}
    </div>
  );
}

export function ViewportOverlay() {
  const camera = useApp((s) => s.camera);
  const setCamera = useApp((s) => s.setCamera);
  const mode = useApp((s) => s.mode);
  const opponentId = useApp((s) => s.opponentId);
  const setOpponent = useApp((s) => s.setOpponent);
  const runState = useApp((s) => s.runState);
  const opp = OPPONENTS.find((o) => o.id === opponentId);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="pointer-events-auto flex flex-col gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-ink-950/75 p-1 pr-2 backdrop-blur-md hairline">
            <Segmented size="sm" value={camera} onChange={setCamera} options={CAMERAS} />
            <IconCamera size={13} className="text-dim" />
          </div>
          <Toggles />
        </div>
        <div className="pointer-events-auto w-[230px] rounded-xl bg-ink-950/75 p-2 backdrop-blur-md hairline">
          <label className="label mb-1 block px-0.5">Opponent bot</label>
          <select
            value={opponentId}
            onChange={(e) => setOpponent(e.target.value as OpponentId)}
            disabled={runState === "running"}
            className="h-7 w-full rounded-md bg-ink-800 px-1.5 text-[12px] text-fg outline-none hairline disabled:opacity-50"
          >
            {OPPONENTS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {opp && <p className="mt-1 px-0.5 text-[10.5px] leading-snug text-dim">{opp.blurb}</p>}
        </div>
      </div>

      <Toast />

      <div className="flex items-end justify-between gap-3">
        <div className="pointer-events-auto">{mode === "manual" ? <DriverHints /> : <ProgressStrip />}</div>
        {mode === "auto" && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-ink-950/75 px-3 py-2 text-[10.5px] text-muted backdrop-blur-md hairline">
            <span>Profile</span>
            <span className="h-1.5 w-20 rounded-full" style={{ background: "linear-gradient(90deg,#22d3ee,#f59e0b)" }} />
            <span className="font-mono">slow → fast</span>
            <span className="ml-2 h-2 w-2 rounded-sm border border-deep/70" />
            <span>ghost = plan</span>
          </div>
        )}
      </div>
    </div>
  );
}
