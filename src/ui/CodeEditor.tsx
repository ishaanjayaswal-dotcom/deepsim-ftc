import { useMemo, useRef, type KeyboardEvent } from "react";
import type { ParseIssue } from "../path/types";

const LINE = 20; // px — must match .code-layer line-height

/** Lightweight tokenizer for JSON-ish path code. Returns HTML-safe spans. */
function highlight(src: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*')(\s*:)?|(-?\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b)|\b(true|false|null|const|let|var|export)\b|([A-Za-z_$][\w$]*)(\s*:)|([{}[\],:;=])/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    out += esc(src.slice(last, m.index));
    if (m[1]) out += `<span class="tok-com">${esc(m[1])}</span>`;
    else if (m[2]) out += m[3] ? `<span class="tok-key">${esc(m[2])}</span><span class="tok-pun">${m[3]}</span>` : `<span class="tok-str">${esc(m[2])}</span>`;
    else if (m[4]) out += `<span class="tok-num">${m[4]}</span>`;
    else if (m[5]) out += `<span class="tok-kw">${m[5]}</span>`;
    else if (m[6]) out += `<span class="tok-key">${m[6]}</span><span class="tok-pun">${m[7]}</span>`;
    else if (m[8]) out += `<span class="tok-pun">${m[8]}</span>`;
    last = re.lastIndex;
  }
  out += esc(src.slice(last));
  return out + "\n";
}

export function CodeEditor({
  value,
  onChange,
  issues,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  issues: ParseIssue[];
  onSubmit: () => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pre = useRef<HTMLDivElement>(null);
  const gutter = useRef<HTMLDivElement>(null);
  const lines = value.split("\n").length;
  const html = useMemo(() => highlight(value), [value]);
  const issueLines = useMemo(() => {
    const m = new Map<number, ParseIssue["severity"]>();
    for (const i of issues) if (i.line) m.set(i.line, m.get(i.line) === "error" ? "error" : i.severity);
    return m;
  }, [issues]);

  const syncScroll = () => {
    if (!ta.current) return;
    const { scrollTop, scrollLeft } = ta.current;
    if (pre.current) {
      pre.current.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
    }
    if (gutter.current) gutter.current.style.transform = `translateY(${-scrollTop}px)`;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget;
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onSubmit();
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      const { selectionStart: s, selectionEnd: end } = el;
      const next = value.slice(0, s) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => el.setSelectionRange(s + 2, s + 2));
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // Keep indentation of the current line.
      const s = el.selectionStart;
      const lineStart = value.lastIndexOf("\n", s - 1) + 1;
      const indent = value.slice(lineStart).match(/^\s*/)?.[0] ?? "";
      const extra = /[[{]\s*$/.test(value.slice(lineStart, s)) ? "  " : "";
      e.preventDefault();
      const ins = "\n" + indent + extra;
      onChange(value.slice(0, s) + ins + value.slice(el.selectionEnd));
      requestAnimationFrame(() => el.setSelectionRange(s + ins.length, s + ins.length));
    }
  };

  return (
    <div className="relative flex min-h-0 flex-1 overflow-hidden rounded-xl bg-ink-950 hairline">
      {/* gutter */}
      <div className="relative w-10 shrink-0 overflow-hidden border-r border-line bg-ink-900/60">
        <div ref={gutter} className="code-layer pt-[10px] text-right" style={{ padding: "10px 8px 40px 0" }}>
          {Array.from({ length: lines }, (_, i) => {
            const sev = issueLines.get(i + 1);
            return (
              <div key={i} className={sev === "error" ? "text-bad" : sev === "warning" ? "text-warn" : "text-dim/70"} style={{ height: LINE }}>
                {sev ? "●" : i + 1}
              </div>
            );
          })}
        </div>
      </div>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div ref={pre} aria-hidden className="pointer-events-none absolute left-0 top-0 min-w-full">
          {[...issueLines.entries()].map(([line, sev]) => (
            <div key={line} className={sev === "error" ? "absolute left-0 w-[4000px] bg-bad/12" : "absolute left-0 w-[4000px] bg-warn/10"} style={{ top: 10 + (line - 1) * LINE, height: LINE }} />
          ))}
          <pre className="code-layer relative pl-3 text-fg/90" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
        <textarea
          ref={ta}
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          aria-label="Path code editor"
          onChange={(e) => onChange(e.target.value)}
          onScroll={syncScroll}
          onKeyDown={onKeyDown}
          className="code-layer absolute inset-0 h-full w-full resize-none overflow-auto bg-transparent pl-3 text-transparent caret-deep outline-none selection:bg-deep/25"
        />
      </div>
    </div>
  );
}
