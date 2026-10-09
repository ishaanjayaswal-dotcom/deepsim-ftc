import { useApp } from "../store/app";
import { EditorPanel } from "./EditorPanel";
import { HubPanel } from "./HubPanel";
import { IconCode, IconUsers } from "./icons";
import { cx } from "./primitives";

export function Sidebar() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const tabs = [
    { id: "editor" as const, label: "Path Editor", icon: IconCode },
    { id: "hub" as const, label: "Community Hub", icon: IconUsers },
  ];
  return (
    <aside className="panel flex min-h-0 w-[372px] shrink-0 flex-col border-r border-line">
      <nav className="flex gap-1 border-b border-line px-3 pt-2.5" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx(
              "relative flex items-center gap-1.5 px-2.5 pb-2.5 pt-1 text-[12.5px] font-medium transition-colors",
              tab === t.id ? "text-fg" : "text-muted hover:text-fg",
            )}
          >
            <t.icon size={14} />
            {t.label}
            {tab === t.id && <span className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-deep shadow-[0_0_10px_rgba(34,211,238,0.7)]" />}
          </button>
        ))}
      </nav>
      {/* Keep both mounted so editor state and hub list survive tab switches. */}
      <div className={cx("min-h-0 flex-1 flex-col", tab === "editor" ? "flex" : "hidden")}>
        <EditorPanel />
      </div>
      <div className={cx("min-h-0 flex-1 flex-col", tab === "hub" ? "flex" : "hidden")}>
        <HubPanel />
      </div>
    </aside>
  );
}
