import { useEffect, useState } from "react";
import type { Finding, Metric, MetricId } from "../eval/advocate";
import { bus } from "../sim/bus";
import { useApp, type SimEvent } from "../store/app";
import { IconAlert, IconBolt, IconCheck, IconChevron, IconSpark } from "./icons";
import { Badge, Button, cx, scoreColor, usePoll } from "./primitives";

const METRIC_ORDER: MetricId[] = ["legality", "efficiency", "yield", "defense"];
const METRIC_BLURB: Record<MetricId, string> = {
  legality: "Footprint vs. field bounds & structures",
  efficiency: "Planned time vs. drivetrain limits",
  yield: "Expected points from scoring triggers",
  defense: "Head-to-head vs. the opponent bot",
};

function GradeRing({ score, grade }: { score: number; grade: string }) {
  const r = 34;
  const c = 2 * Math.PI * r;
  const color = scoreColor(score);
  return (
    <div className="relative h-[84px] w-[84px] shrink-0">
      <svg viewBox="0 0 84 84" className="h-full w-full -rotate-90">
        <circle cx="42" cy="42" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
        <circle
          cx="42"
          cy="42"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${(score / 100) * c} ${c}`}
          style={{ transition: "stroke-dasharray 900ms cubic-bezier(.2,.8,.2,1), stroke 300ms", filter: `drop-shadow(0 0 6px ${color}55)` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center leading-none">
        <span className="text-[26px] font-bold tracking-tight" style={{ color }}>
          {grade}
        </span>
        <span className="mt-1 font-mono text-[11px] text-muted tabular">{score}/100</span>
      </div>
    </div>
  );
}

const FINDING_ICON: Record<Finding["level"], { icon: typeof IconCheck; cls: string }> = {
  pass: { icon: IconCheck, cls: "text-good" },
  info: { icon: IconSpark, cls: "text-deep" },
  warn: { icon: IconAlert, cls: "text-warn" },
  fail: { icon: IconAlert, cls: "text-bad" },
};

function MetricCard({ m, index, nonce, defaultOpen }: { m: Metric; index: number; nonce: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(m.score));
    return () => cancelAnimationFrame(id);
  }, [m.score, nonce]);
  useEffect(() => setOpen(defaultOpen), [defaultOpen, nonce]);
  const color = scoreColor(m.score);
  const shown = open ? m.findings : m.findings.slice(0, 2);
  return (
    <section key={nonce} className="rise rounded-xl bg-ink-850 p-3 hairline" style={{ animationDelay: `${index * 70}ms` }}>
      <button className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <div className="min-w-0">
          <div className="text-[12.5px] font-semibold">{m.label}</div>
          <div className="text-[10.5px] text-dim">{METRIC_BLURB[m.id]}</div>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-[13px] font-semibold tabular" style={{ color }}>
            {m.value}
          </span>
          <IconChevron size={13} className={cx("text-dim transition-transform", open && "rotate-90")} />
        </div>
      </button>
      <div className="mt-2.5 flex items-center gap-2">
        <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${width}%`,
              background: `linear-gradient(90deg, ${color}99, ${color})`,
              boxShadow: `0 0 10px ${color}66`,
              transition: "width 900ms cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
        <span className="w-7 text-right font-mono text-[10.5px] text-muted tabular">{m.score}</span>
      </div>
      <p className="mt-2 text-[11.5px] leading-snug text-fg/85">{m.headline}</p>
      <ul className="mt-1.5 space-y-1">
        {shown.map((f, i) => {
          const I = FINDING_ICON[f.level];
          return (
            <li key={i} className="flex items-start gap-1.5 text-[11px] leading-snug text-muted">
              <I.icon size={12} className={cx("mt-[1px] shrink-0", I.cls)} />
              <span>{f.text}</span>
            </li>
          );
        })}
      </ul>
      {!open && m.findings.length > 2 && (
        <button onClick={() => setOpen(true)} className="mt-1 text-[10.5px] font-medium text-deep/80 hover:text-deep">
          +{m.findings.length - 2} more findings
        </button>
      )}
    </section>
  );
}

function Telemetry() {
  const t = usePoll(() => ({ ...bus.telemetry, time: bus.simTime }), 12);
  const maxV = useApp((s) => s.robot.freeSpeed);
  const slipPct = Math.min(1.4, t.slip);
  const slipColor = t.slip > 1 ? "#ef4444" : t.slip > 0.75 ? "#f59e0b" : "#4ade80";
  const phaseTone = t.phase === "follow" || t.phase === "settle" ? "deep" : t.phase === "action" ? "warn" : t.phase === "done" ? "good" : "neutral";
  return (
    <section className="rounded-xl bg-ink-850 p-3 hairline">
      <div className="mb-2 flex items-center justify-between">
        <span className="label">Live telemetry</span>
        <div className="flex items-center gap-1">
          {t.holding && <Badge tone={t.holding.color === "yellow" ? "warn" : t.holding.color === "red" ? "red" : "blue"}>holding {t.holding.kind}</Badge>}
          <Badge tone={phaseTone}>{t.action && t.phase === "action" ? t.action.replace("_", " ") : t.phase}</Badge>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        <Gauge label="Speed" value={`${t.speed.toFixed(0)}`} unit="in/s" pct={t.speed / maxV} color="#22d3ee" sub={`cmd ${t.cmdSpeed.toFixed(0)}`} />
        <Gauge label="Traction used" value={`${(t.slip * 100).toFixed(0)}`} unit="%" pct={slipPct / 1.4} color={slipColor} sub={t.slip > 1 ? "SLIPPING" : "grip"} />
        <Stat label="Cross-track" value={`${t.crossTrack.toFixed(2)}"`} warn={Math.abs(t.crossTrack) > 1.5} />
        <Stat label="Heading err" value={`${t.headingErr.toFixed(1)}°`} warn={Math.abs(t.headingErr) > 6} />
        <Stat label="Pose" value={`${t.x.toFixed(1)}, ${t.y.toFixed(1)}`} />
        <Stat label="Heading" value={`${(((t.heading * 180) / Math.PI + 360) % 360).toFixed(0)}°  ω ${t.omega.toFixed(0)}`} />
      </div>
    </section>
  );
}

function Gauge({ label, value, unit, pct, color, sub }: { label: string; value: string; unit: string; pct: number; color: string; sub: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[10.5px] text-dim">{label}</span>
        <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: sub === "SLIPPING" ? color : undefined }}>
          <span className={sub === "SLIPPING" ? "" : "text-dim"}>{sub}</span>
        </span>
      </div>
      <div className="font-mono text-[17px] font-semibold leading-tight tabular">
        {value}
        <span className="ml-0.5 text-[10px] font-normal text-dim">{unit}</span>
      </div>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full rounded-full transition-[width] duration-100" style={{ width: `${Math.min(100, pct * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className="text-[10.5px] text-dim">{label}</div>
      <div className={cx("font-mono text-[12px] tabular", warn ? "text-warn" : "text-fg/90")}>{value}</div>
    </div>
  );
}

const EVENT_STYLE: Record<SimEvent["kind"], string> = {
  score: "bg-good",
  miss: "bg-warn",
  contact: "bg-bad",
  slip: "bg-warn",
  intake: "bg-deep",
  info: "bg-dim",
};

function EventLog() {
  const events = useApp((s) => s.events);
  return (
    <section className="rounded-xl bg-ink-850 p-3 hairline">
      <div className="label mb-2">Event log</div>
      {events.length === 0 ? (
        <div className="py-3 text-center text-[11.5px] text-dim">Run the path to stream scoring, contact and slip events.</div>
      ) : (
        <ol className="max-h-[200px] space-y-1 overflow-y-auto pr-1">
          {events.map((e) => (
            <li key={e.id} className="rise flex items-start gap-2 text-[11.5px] leading-snug">
              <span className="w-10 shrink-0 font-mono text-[10.5px] text-dim tabular">{e.t.toFixed(1)}s</span>
              <span className={cx("mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full", EVENT_STYLE[e.kind])} />
              <span className={e.kind === "score" ? "text-fg" : "text-muted"}>{e.text}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function AnalyticsRail() {
  const evaluation = useApp((s) => s.evaluation);
  const nonce = useApp((s) => s.evalNonce);
  const opponentName = useApp((s) => s.opponent?.spec.name.replace("Opponent · ", ""));
  const mode = useApp((s) => s.mode);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    setAnalysing(true);
    const id = setTimeout(() => setAnalysing(false), 650);
    return () => clearTimeout(id);
  }, [nonce]);

  const worst = evaluation ? METRIC_ORDER.reduce((a, b) => (evaluation.metrics[b].score < evaluation.metrics[a].score ? b : a)) : null;

  return (
    <aside className="panel flex min-h-0 w-[348px] shrink-0 flex-col border-l border-line">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet/12 text-violet">
            <IconSpark size={15} />
          </div>
          <div className="leading-tight">
            <div className="text-[13px] font-semibold">Simulation Advocate</div>
            <div className="text-[10.5px] text-dim">{analysing ? "Analysing path…" : "Rule engine · deterministic"}</div>
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => useApp.getState().applySource({ reset: false })} title="Re-run analysis">
          <IconBolt size={13} /> Re-run
        </Button>
      </div>
      {analysing && <div className="shimmer h-px w-full" />}

      <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-3">
        {!evaluation ? (
          <div className="rounded-xl bg-ink-850 p-4 text-[12px] text-dim hairline">Fix the path errors in the editor to get a performance report.</div>
        ) : (
          <>
            <section key={`o${nonce}`} className="rise rounded-xl bg-gradient-to-br from-ink-800 to-ink-850 p-3 hairline">
              <div className="flex items-center gap-3">
                <GradeRing score={evaluation.overall} grade={evaluation.grade} />
                <div className="min-w-0">
                  <div className="label">Performance</div>
                  <p className="mt-1 text-[12px] leading-snug text-fg/90">{evaluation.summary}</p>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <Mini label="Expected" value={`${evaluation.scoring.expected.toFixed(0)} pts`} />
                <Mini label="Ceiling" value={`${evaluation.scoring.ceiling} pts`} />
                <Mini label="Duration" value={`${evaluation.durations.total.toFixed(1)} s`} warn={evaluation.durations.total > 30} />
              </div>
              {opponentName && <div className="mt-2 text-[10.5px] text-dim">Defense scenario: {opponentName}</div>}
            </section>
            {METRIC_ORDER.map((id, i) => (
              <MetricCard key={id} m={evaluation.metrics[id]} index={i + 1} nonce={nonce} defaultOpen={id === worst && evaluation.metrics[id].score < 85} />
            ))}
          </>
        )}
        {mode === "manual" && <div className="rounded-lg bg-white/[0.03] px-3 py-2 text-[11px] text-dim">Driver mode: the report reflects the loaded path; telemetry below is live.</div>}
        <Telemetry />
        <EventLog />
      </div>
    </aside>
  );
}

function Mini({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="rounded-lg bg-black/20 px-2 py-1.5 hairline">
      <div className="text-[9.5px] font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className={cx("font-mono text-[12.5px] font-semibold tabular", warn ? "text-bad" : "text-fg")}>{value}</div>
    </div>
  );
}
