import { useState } from "react";
import { AUTO_SECONDS, POINTS, TELEOP_SECONDS } from "../config/robot";
import { bus } from "../sim/bus";
import { useApp } from "../store/app";
import { IconGear, IconPause, IconPlay, IconReset, Logo } from "./icons";
import { Button, Segmented, cx, usePoll } from "./primitives";
import { SettingsPopover } from "./SettingsPopover";

function MatchClock() {
  const mode = useApp((s) => s.mode);
  const runState = useApp((s) => s.runState);
  const t = usePoll(() => bus.simTime, 15);
  const limit = mode === "auto" ? AUTO_SECONDS : TELEOP_SECONDS;
  const left = Math.max(0, limit - t);
  const mm = Math.floor(left / 60);
  const ss = (left % 60).toFixed(1).padStart(4, "0");
  const pct = Math.min(1, t / limit);
  const danger = left < 5 && runState === "running";
  return (
    <div className="flex items-center gap-2.5">
      <div className="relative h-8 w-8">
        <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="3" />
          <circle cx="18" cy="18" r="15" fill="none" stroke={danger ? "#ef4444" : "#22d3ee"} strokeWidth="3" strokeDasharray={`${pct * 94.2} 94.2`} strokeLinecap="round" />
        </svg>
      </div>
      <div className="leading-none">
        <div className={cx("font-mono text-[17px] font-semibold tabular", danger ? "text-bad" : "text-fg")}>
          {mm}:{ss}
        </div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-dim">{mode === "auto" ? "Autonomous" : "Driver-controlled"}</div>
      </div>
    </div>
  );
}

function ScoreBoard() {
  const score = useApp((s) => s.score);
  const alliance = useApp((s) => s.compiled?.spec.alliance ?? "red");
  const chips = [
    { k: "HB", v: score.highBasket, pts: POINTS.highBasket, title: "High basket" },
    { k: "LB", v: score.lowBasket, pts: POINTS.lowBasket, title: "Low basket" },
    { k: "NZ", v: score.netZone, pts: POINTS.netZone, title: "Net zone" },
    { k: "HC", v: score.highChamber, pts: POINTS.highChamber, title: "High chamber" },
    { k: "LC", v: score.lowChamber, pts: POINTS.lowChamber, title: "Low chamber" },
  ];
  return (
    <div className="flex items-center gap-3">
      <div className="hidden items-center gap-1 xl:flex">
        {chips.map((c) => (
          <div key={c.k} title={`${c.title} · ${c.pts} pts each`} className={cx("rounded-md px-1.5 py-1 text-center leading-none hairline", c.v ? "bg-white/[0.04]" : "opacity-50")}>
            <div className="font-mono text-[12px] font-semibold tabular text-fg">{c.v}</div>
            <div className="mt-0.5 text-[9px] font-semibold tracking-wider text-dim">{c.k}</div>
          </div>
        ))}
        <div title="Park" className={cx("rounded-md px-1.5 py-1 text-center leading-none hairline", score.park ? "bg-violet/10" : "opacity-50")}>
          <div className="font-mono text-[12px] font-semibold text-fg">{score.park ? "✓" : "–"}</div>
          <div className="mt-0.5 text-[9px] font-semibold tracking-wider text-dim">PARK</div>
        </div>
      </div>
      <div
        className={cx(
          "flex h-10 min-w-[86px] items-center justify-between gap-3 rounded-xl px-3",
          alliance === "red" ? "bg-red-alliance/15 shadow-[inset_0_0_0_1px_rgba(229,56,59,0.35)]" : "bg-blue-alliance/15 shadow-[inset_0_0_0_1px_rgba(47,111,237,0.4)]",
        )}
      >
        <span className={cx("text-[10px] font-bold uppercase tracking-[0.14em]", alliance === "red" ? "text-[#ff8587]" : "text-[#86adff]")}>{alliance}</span>
        <span key={score.total} className="rise font-mono text-[22px] font-bold tabular text-fg">
          {score.total}
        </span>
      </div>
    </div>
  );
}

export function TopBar() {
  const mode = useApp((s) => s.mode);
  const runState = useApp((s) => s.runState);
  const compiled = useApp((s) => s.compiled);
  const { setMode, run, pause, resume, reset } = useApp.getState();
  const [settings, setSettings] = useState(false);

  const primary =
    runState === "running" ? (
      <Button variant="secondary" onClick={pause} title="Pause (P)">
        <IconPause size={14} /> Pause
      </Button>
    ) : runState === "paused" ? (
      <Button variant="primary" onClick={resume} title="Resume (P)">
        <IconPlay size={14} /> Resume
      </Button>
    ) : (
      <Button variant="primary" onClick={run} disabled={mode === "auto" && !compiled} title={mode === "auto" ? "Run the path (⌘↵ in the editor)" : "Start the driver period"}>
        <IconPlay size={14} /> {mode === "auto" ? (runState === "finished" ? "Run again" : "Run auto") : "Start match"}
      </Button>
    );

  return (
    <header className="relative z-20 flex h-14 shrink-0 items-center gap-4 border-b border-line bg-ink-950/90 px-4 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="leading-none">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-tight">DeepSim</span>
            <span className="text-[11px] font-medium text-muted">FTC Physics Simulator</span>
          </div>
          <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-deep/80">Into The Deep · 2024–25</div>
        </div>
      </div>

      <div className="mx-2 h-6 w-px bg-line" />

      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { value: "auto", label: "Autonomous", title: "Run a path with the follower" },
          { value: "manual", label: "Driver", title: "Keyboard driving (WASD)" },
        ]}
      />

      <div className="flex items-center gap-1.5">
        {primary}
        <Button variant="ghost" onClick={reset} title="Reset field (R)">
          <IconReset size={14} /> Reset
        </Button>
      </div>

      <div className="flex-1" />

      <MatchClock />
      <div className="h-6 w-px bg-line" />
      <ScoreBoard />
      <div className="relative">
        <Button variant="ghost" className="h-9 w-9 !px-0" onClick={() => setSettings((v) => !v)} aria-label="Physics settings" aria-expanded={settings}>
          <IconGear size={17} />
        </Button>
        {settings && <SettingsPopover onClose={() => setSettings(false)} />}
      </div>
    </header>
  );
}
