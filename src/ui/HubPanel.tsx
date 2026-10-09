import { useCallback, useEffect, useState } from "react";
import { repository } from "../repo/client";
import { STRATEGY_CATEGORIES, type PathRecord } from "../repo/types";
import { useApp } from "../store/app";
import { IconSearch, IconUsers } from "./icons";
import { Segmented, cx } from "./primitives";
import { PathCard } from "./PathCard";

export function HubPanel() {
  const hubNonce = useApp((s) => s.hubNonce);
  const [rows, setRows] = useState<PathRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [category, setCategory] = useState("");
  const [sort, setSort] = useState<"new" | "top">("top");

  const load = useCallback(async () => {
    setError(null);
    try {
      setRows(await repository.list({ q: q.trim() || undefined, category: category || undefined, sort }));
    } catch (e) {
      setError((e as Error).message);
      setRows([]);
    }
  }, [q, category, sort]);

  useEffect(() => {
    const id = setTimeout(load, q ? 200 : 0);
    return () => clearTimeout(id);
  }, [load, hubNonce, q]);

  const app = useApp.getState;
  const execute = (r: PathRecord) => {
    app().loadPath(r.data, { origin: "community", recordId: r.id, teamNumber: r.teamNumber });
    if (app().issues.some((i) => i.severity === "error")) app().showToast(`"${r.name}" failed to parse`, "bad");
    else app().showToast(`Executing "${r.name}" · #${r.teamNumber}`, "info");
  };
  const edit = (r: PathRecord) => {
    useApp.setState({ active: { origin: "community", recordId: r.id, teamNumber: r.teamNumber } });
    app().setSource(r.data);
    app().setTab("editor");
  };
  const mutate = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) app().showToast(ok, "good");
      await load();
    } catch (e) {
      app().showToast((e as Error).message, "bad");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-2.5 border-b border-line p-3">
        <div className="relative">
          <IconSearch size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-dim" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search paths, teams, strategies…"
            className="h-8 w-full rounded-lg bg-ink-800 pl-8 pr-2 text-[12.5px] text-fg outline-none placeholder:text-dim hairline focus:ring-2 focus:ring-deep/40"
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="h-7 min-w-0 flex-1 rounded-md bg-ink-800 px-1.5 text-[12px] text-fg outline-none hairline"
            aria-label="Filter by strategy"
          >
            <option value="">All strategies</option>
            {STRATEGY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <Segmented
            size="sm"
            value={sort}
            onChange={setSort}
            options={[
              { value: "top", label: "Top" },
              { value: "new", label: "New" },
            ]}
          />
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] text-dim">
          <span className={cx("h-1.5 w-1.5 rounded-full", repository.kind === "http" ? "bg-good" : "bg-warn")} />
          {repository.kind === "http" ? "Connected to the community API" : "Local store — set VITE_PATHS_API to go live"}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {rows === null &&
          Array.from({ length: 3 }, (_, i) => <div key={i} className="shimmer h-[142px] rounded-xl bg-ink-850 hairline" />)}
        {error && <div className="rounded-lg bg-bad/10 p-3 text-[12px] text-bad hairline">Couldn't reach the repository: {error}</div>}
        {rows?.length === 0 && !error && (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <IconUsers size={26} className="text-dim" />
            <div className="text-[13px] font-medium">No paths match</div>
            <div className="text-[12px] text-dim">Publish one from the editor — Gracious Professionalism starts with sharing.</div>
          </div>
        )}
        {rows?.map((r) => (
          <PathCard
            key={r.id}
            record={r}
            onExecute={() => execute(r)}
            onEdit={() => edit(r)}
            onUpvote={() => mutate(() => repository.upvote(r.id))}
            onDelete={() => mutate(() => repository.remove(r.id), `Deleted "${r.name}"`)}
          />
        ))}
      </div>
    </div>
  );
}
