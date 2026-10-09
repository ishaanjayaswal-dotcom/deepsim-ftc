import { useEffect, useRef, useState } from "react";
import { formatSource } from "../path/parser";
import { PRESETS, presetSource } from "../path/presets";
import { useApp } from "../store/app";
import { CodeEditor } from "./CodeEditor";
import { IconAlert, IconCheck, IconPlay, IconUpload, IconWand } from "./icons";
import { Badge, Button, cx } from "./primitives";
import { PublishDialog } from "./PublishDialog";

const ACTION_TONE: Record<string, "good" | "warn" | "violet" | "neutral"> = {
  intake: "good",
  intake_sample: "good",
  intake_specimen: "good",
  score_high: "warn",
  score_low: "warn",
  specimen_high: "violet",
  specimen_low: "violet",
  park: "neutral",
};

export function EditorPanel() {
  const source = useApp((s) => s.source);
  const issues = useApp((s) => s.issues);
  const compiled = useApp((s) => s.compiled);
  const active = useApp((s) => s.active);
  const { setSource, applySource, run } = useApp.getState();
  const [publishing, setPublishing] = useState(false);
  const [preset, setPreset] = useState("");

  // Live re-analysis while typing (debounced). Resets the stage only when nothing is running.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const id = setTimeout(() => applySource(), 350);
    return () => clearTimeout(id);
  }, [source, applySource]);

  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const stale = errors.length > 0 && compiled;

  const runNow = () => {
    applySource({ reset: false });
    if (useApp.getState().issues.some((i) => i.severity === "error")) return;
    useApp.setState({ mode: "auto" });
    run();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <select
          value={preset}
          onChange={(e) => {
            const id = e.target.value;
            setPreset("");
            if (!id) return;
            useApp.setState({ active: { origin: "editor" } });
            setSource(presetSource(id));
          }}
          className="h-8 min-w-0 flex-1 rounded-lg bg-ink-800 px-2 text-[12.5px] text-fg outline-none hairline focus:ring-2 focus:ring-deep/40"
          aria-label="Load an example path"
        >
          <option value="">Load example…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {(p.body.name as string) ?? p.id} — {p.category}
            </option>
          ))}
        </select>
        <Button
          size="sm"
          variant="ghost"
          title="Format"
          onClick={() => {
            const f = formatSource(source);
            if (f) setSource(f);
          }}
        >
          <IconWand size={14} /> Format
        </Button>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13.5px] font-semibold">{compiled?.spec.name ?? "Untitled path"}</div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
            {compiled && <Badge tone={compiled.spec.alliance === "red" ? "red" : "blue"}>{compiled.spec.alliance.toUpperCase()}</Badge>}
            {compiled && compiled.spec.preload !== "none" && <Badge>preload {compiled.spec.preload}</Badge>}
            {active.origin === "community" && <Badge tone="violet">from hub · #{active.teamNumber}</Badge>}
          </div>
        </div>
        {compiled && (
          <div className="shrink-0 text-right font-mono text-[11px] leading-tight text-muted tabular">
            <div>
              <span className="text-fg">{compiled.totalLength.toFixed(0)}</span> in
            </div>
            <div>
              <span className={compiled.duration > 30 ? "text-bad" : "text-fg"}>{compiled.duration.toFixed(1)}</span> s
            </div>
          </div>
        )}
      </div>

      <CodeEditor value={source} onChange={setSource} issues={issues} onSubmit={runNow} />

      {/* status / issues */}
      <div className="max-h-[118px] shrink-0 space-y-1 overflow-y-auto">
        {errors.length === 0 && warnings.length === 0 && (
          <div className="flex items-center gap-1.5 text-[11.5px] text-good">
            <IconCheck size={13} /> Valid · {compiled?.segments.length} segments in {compiled?.chains.length} chains
          </div>
        )}
        {stale && <div className="text-[11px] text-warn">Showing the last valid path while you fix the errors below.</div>}
        {[...errors, ...warnings].map((i, k) => (
          <div key={k} className={cx("flex items-start gap-1.5 text-[11.5px] leading-snug", i.severity === "error" ? "text-bad" : "text-warn")}>
            <IconAlert size={13} className="mt-[1px] shrink-0" />
            <span>
              {i.line ? <span className="font-mono text-dim">L{i.line} </span> : null}
              {i.message}
            </span>
          </div>
        ))}
      </div>

      {/* segment strip */}
      {compiled && (
        <div className="shrink-0 rounded-xl bg-ink-850 p-2 hairline">
          <div className="label mb-1.5 px-1">Chains</div>
          <div className="flex max-h-[104px] flex-col gap-0.5 overflow-y-auto">
            {compiled.chains.map((c) => {
              const w = compiled.spec.waypoints[c.segTo + 1];
              return (
                <div key={c.index} className="flex items-center gap-2 rounded-md px-1 py-0.5 text-[11.5px] hover:bg-white/[0.03]">
                  <span className="w-4 font-mono text-dim">{c.index + 1}</span>
                  <span className="flex-1 truncate text-muted">
                    {c.segTo - c.segFrom + 1} seg · {c.turnOnly ? "turn" : `${c.length.toFixed(0)}"`}
                  </span>
                  {w.action && <Badge tone={ACTION_TONE[w.action] ?? "neutral"}>{w.action.replace("_", " ")}</Badge>}
                  <span className="w-12 text-right font-mono text-muted tabular">{(c.endTime - c.startTime).toFixed(1)}s</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex shrink-0 gap-2">
        <Button variant="primary" className="flex-1" onClick={runNow} disabled={errors.length > 0} title="⌘/Ctrl + Enter">
          <IconPlay size={14} /> Run in simulator
        </Button>
        <Button onClick={() => setPublishing(true)} disabled={errors.length > 0}>
          <IconUpload size={14} /> Publish Path
        </Button>
      </div>

      {publishing && <PublishDialog onClose={() => setPublishing(false)} />}
    </div>
  );
}
