import { useState } from "react";
import { encodeDataString } from "../path/parser";
import type { PathRecord } from "../repo/types";
import { useApp } from "../store/app";
import { IconArrowUp, IconCopy, IconEdit, IconPlay, IconTrash } from "./icons";
import { PathThumbnail } from "./PathThumbnail";
import { Badge, Button, cx, scoreTone } from "./primitives";

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

const gradeScore = (g?: string) => (g ? ({ "A+": 95, A: 88, B: 78, C: 70, D: 60, F: 40 } as Record<string, number>)[g] ?? 60 : 60);

export function PathCard({
  record,
  canDelete,
  voted,
  onExecute,
  onEdit,
  onUpvote,
  onDelete,
}: {
  record: PathRecord;
  canDelete: boolean;
  voted: boolean;
  onExecute: () => void;
  onEdit: () => void;
  onUpvote: () => void;
  onDelete: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const activeId = useApp((s) => s.active.recordId);
  const alliance = /"alliance"\s*:\s*"blue"|alliance:\s*'blue'/.test(record.data) ? "blue" : "red";
  const isActive = activeId === record.id;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(encodeDataString(record.data));
      useApp.getState().showToast("Data string copied — paste it into any editor", "info");
    } catch {
      useApp.getState().showToast("Clipboard unavailable", "bad");
    }
  };

  return (
    <article
      className={cx(
        "group rise rounded-xl bg-ink-850 p-2.5 transition-[box-shadow,background] duration-200 hairline hover:bg-ink-800",
        isActive && "shadow-[inset_0_0_0_1px_rgba(34,211,238,0.45)]",
      )}
    >
      <div className="flex gap-3">
        <PathThumbnail points={record.thumbnail} alliance={alliance} className="h-[88px] w-[88px] shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate text-[13px] font-semibold leading-tight">{record.name}</h3>
            {record.stats.grade && <Badge tone={scoreTone(gradeScore(record.stats.grade))}>{record.stats.grade}</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <Badge tone={alliance === "red" ? "red" : "blue"}>#{record.teamNumber}</Badge>
            <Badge tone="deep">{record.category}</Badge>
          </div>
          <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-muted">{record.description || "No description."}</p>
          <div className="mt-1.5 flex items-center gap-2.5 font-mono text-[10.5px] text-dim tabular">
            <span>{record.stats.lengthIn}"</span>
            <span>{record.stats.durationS}s</span>
            <span>{record.stats.segments} seg</span>
            <span className="ml-auto font-sans">{ago(record.createdAt)}</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 flex items-center gap-1.5">
        <Button size="sm" variant="primary" className="flex-1" onClick={onExecute}>
          <IconPlay size={12} /> Execute in Simulator
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={onUpvote}
          disabled={voted}
          className={cx(voted && "!text-deep !opacity-100")}
          title={voted ? "You upvoted this" : "Upvote"}
          aria-label={voted ? `Upvoted, ${record.upvotes} votes` : `Upvote, ${record.upvotes} votes`}
          aria-pressed={voted}
        >
          <IconArrowUp size={12} /> <span className="font-mono tabular">{record.upvotes}</span>
        </Button>
        <Button size="sm" variant="ghost" className="!px-1.5" onClick={onEdit} title="Open in editor" aria-label="Open in editor">
          <IconEdit size={14} />
        </Button>
        <Button size="sm" variant="ghost" className="!px-1.5" onClick={copy} title="Copy data string" aria-label="Copy data string">
          <IconCopy size={14} />
        </Button>
        {!canDelete ? null : confirming ? (
          <Button
            size="sm"
            variant="danger"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onDelete();
              setBusy(false);
              setConfirming(false);
            }}
            onBlur={() => setConfirming(false)}
            autoFocus
          >
            Delete?
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className="!px-1.5 hover:!text-bad" onClick={() => setConfirming(true)} title="Delete" aria-label="Delete path">
            <IconTrash size={14} />
          </Button>
        )}
      </div>
    </article>
  );
}
