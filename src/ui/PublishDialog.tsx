import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { draftFromSource, repository, thumbnailFor } from "../repo/client";
import { deriveFromSource } from "../repo/derive";
import { STRATEGY_CATEGORIES } from "../repo/types";
import { useApp } from "../store/app";
import { IconUpload, IconX } from "./icons";
import { PathThumbnail } from "./PathThumbnail";
import { Badge, Button, scoreTone } from "./primitives";

const guessCategory = (actions: string[]) => {
  const scores = actions.filter((a) => a.startsWith("score")).length;
  const clips = actions.filter((a) => a.startsWith("specimen")).length;
  if (scores && clips) return "Sample + Specimen Hybrid";
  if (clips) return "Specimen Cycle";
  if (scores >= 3) return "4 Sample Auto";
  if (scores) return "Submersible Cycle";
  return "Park Only";
};

export function PublishDialog({ onClose }: { onClose: () => void }) {
  const source = useApp((s) => s.source);
  const compiled = useApp((s) => s.compiled);
  const evaluation = useApp((s) => s.evaluation);
  const active = useApp((s) => s.active);
  const [name, setName] = useState(compiled?.spec.name ?? "");
  const [team, setTeam] = useState(active.teamNumber ? String(active.teamNumber) : "");
  const [category, setCategory] = useState(() => guessCategory(compiled?.spec.waypoints.map((w) => w.action ?? "") ?? []));
  const [description, setDescription] = useState("");
  const [updateOriginal, setUpdateOriginal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const thumb = useMemo(() => (compiled ? thumbnailFor(compiled) : ""), [compiled]);
  // The hub grades every card against the same reference opponent, which may differ from the one picked in the sim.
  const hubGrade = useMemo(() => {
    try {
      return deriveFromSource(source).stats.grade;
    } catch {
      return undefined;
    }
  }, [source]);
  const canUpdate = Boolean(active.recordId && repository.canEdit(active.recordId));

  // Editing a path this browser published: start from its stored metadata, not from the source defaults,
  // so "update the original" never wipes a title, strategy or notes the user didn't touch.
  useEffect(() => {
    if (!canUpdate || !active.recordId) return;
    let live = true;
    repository
      .get(active.recordId)
      .then((rec) => {
        if (!live) return;
        setName(rec.name);
        setTeam(String(rec.teamNumber));
        setCategory(rec.category);
        setDescription(rec.description);
      })
      .catch(() => {
        /* the original is gone; publishing a copy still works */
      });
    return () => {
      live = false;
    };
  }, [canUpdate, active.recordId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const teamNumber = Number(team);
    if (!name.trim()) return setError("Give the path a name.");
    if (!Number.isInteger(teamNumber) || teamNumber < 1 || teamNumber > 99999) return setError("Team number must be 1–99999.");
    setBusy(true);
    try {
      const draft = draftFromSource(source, { name: name.trim(), teamNumber, category, description: description.trim() });
      const rec = updateOriginal && canUpdate && active.recordId ? await repository.update(active.recordId, draft) : await repository.create(draft);
      const app = useApp.getState();
      useApp.setState({ active: { origin: "community", recordId: rec.id, teamNumber: rec.teamNumber } });
      app.bumpHub();
      app.setTab("hub");
      app.showToast(updateOriginal ? `Updated "${rec.name}"` : `Published "${rec.name}" to the hub`, "good");
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form onSubmit={submit} className="rise w-full max-w-[520px] rounded-2xl border border-line-strong bg-ink-850 shadow-2xl" role="dialog" aria-modal aria-labelledby="publish-title">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 id="publish-title" className="text-[15px] font-semibold">
              Publish to the Community Hub
            </h2>
            <p className="text-[12px] text-dim">Shared paths are public. Only this browser can edit or delete what you publish.</p>
          </div>
          <Button type="button" variant="ghost" className="!px-1.5" onClick={onClose} aria-label="Close">
            <IconX size={16} />
          </Button>
        </div>

        <div className="flex gap-4 px-5 py-4">
          <div className="w-[132px] shrink-0">
            <PathThumbnail points={thumb} alliance={compiled?.spec.alliance} className="h-[132px] w-[132px] rounded-xl" />
            {evaluation && (
              <div className="mt-2 flex items-center justify-between text-[11px] text-muted">
                Advocate <Badge tone={scoreTone(evaluation.overall)}>{evaluation.grade} · {evaluation.overall}</Badge>
              </div>
            )}
            {hubGrade && hubGrade !== evaluation?.grade && (
              <div className="mt-1 text-[10.5px] leading-snug text-dim" title="Hub cards are all graded against the Raider opponent so they compare like for like.">
                Hub grade {hubGrade} (vs Raider)
              </div>
            )}
            {compiled && (
              <div className="mt-1 font-mono text-[10.5px] text-dim tabular">
                {compiled.totalLength.toFixed(0)}" · {compiled.duration.toFixed(1)}s · {compiled.segments.length} seg
              </div>
            )}
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <Field label="Path name">
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="input" autoFocus />
            </Field>
            <div className="flex gap-3">
              <Field label="Team #" className="w-24">
                <input value={team} onChange={(e) => setTeam(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="12345" className="input font-mono" />
              </Field>
              <Field label="Strategy" className="flex-1">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className="input">
                  {STRATEGY_CATEGORIES.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="Notes for other teams">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} maxLength={280} placeholder="What it does, robot assumptions, tuning tips…" className="input h-auto resize-none py-2" />
            </Field>
            {canUpdate && (
              <label className="flex items-center gap-2 text-[12px] text-muted">
                <input type="checkbox" checked={updateOriginal} onChange={(e) => setUpdateOriginal(e.target.checked)} className="accent-[#22d3ee]" />
                Update the original hub entry instead of publishing a copy
              </label>
            )}
          </div>
        </div>

        {error && <div className="mx-5 mb-3 rounded-lg bg-bad/10 px-3 py-2 text-[12px] text-bad">{error}</div>}

        <div className="flex justify-end gap-2 border-t border-line px-5 py-3">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            <IconUpload size={14} /> {busy ? "Publishing…" : updateOriginal ? "Save changes" : "Publish Path"}
          </Button>
        </div>
      </form>
    </div>,
    document.body,
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="label mb-1 block">{label}</span>
      {children}
    </label>
  );
}
