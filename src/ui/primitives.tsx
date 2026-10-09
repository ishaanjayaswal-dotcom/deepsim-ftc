import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "ghost" | "danger";

export function Button({
  variant = "secondary",
  size = "md",
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      {...rest}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-[background,color,box-shadow,transform] duration-150 select-none",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-deep/60 active:scale-[0.97] disabled:opacity-40 disabled:pointer-events-none",
        size === "sm" ? "h-7 px-2.5 text-[12px]" : "h-8.5 px-3.5 text-[13px]",
        variant === "primary" && "bg-deep text-ink-950 hover:bg-[#4fe0f3] shadow-[0_0_0_1px_rgba(34,211,238,0.4),0_6px_20px_-6px_rgba(34,211,238,0.55)]",
        variant === "secondary" && "bg-ink-700/80 text-fg hover:bg-ink-600 hairline",
        variant === "ghost" && "text-muted hover:text-fg hover:bg-white/5",
        variant === "danger" && "bg-bad/15 text-bad hover:bg-bad/25 hairline",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  size = "md",
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex rounded-lg bg-ink-800 p-0.5 hairline" role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cx(
            "rounded-md font-medium transition-colors duration-150",
            size === "sm" ? "h-6 px-2 text-[11px]" : "h-7 px-3 text-[12.5px]",
            o.value === value ? "bg-ink-600 text-fg shadow-[0_1px_0_rgba(255,255,255,0.06)_inset]" : "text-muted hover:text-fg",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "deep" | "good" | "warn" | "bad" | "red" | "blue" | "violet"; className?: string }) {
  const tones: Record<string, string> = {
    neutral: "bg-white/6 text-muted",
    deep: "bg-deep/12 text-deep",
    good: "bg-good/12 text-good",
    warn: "bg-warn/12 text-warn",
    bad: "bg-bad/12 text-bad",
    red: "bg-red-alliance/15 text-[#ff7b7d]",
    blue: "bg-blue-alliance/18 text-[#7aa5ff]",
    violet: "bg-violet/12 text-violet",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tracking-wide", tones[tone], className)}>{children}</span>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[5px] bg-ink-700 px-1 font-mono text-[10.5px] text-fg/90 shadow-[inset_0_-1px_0_rgba(0,0,0,0.5)] hairline">{children}</kbd>;
}

/** Poll a value derived from the mutable sim bus at a fixed rate (keeps React off the physics hot path). */
export function usePoll<T>(read: () => T, hz = 10): T {
  const [v, setV] = useState(read);
  useEffect(() => {
    const id = setInterval(() => setV(read()), 1000 / hz);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hz]);
  return v;
}

export const scoreTone = (s: number) => (s >= 85 ? "good" : s >= 65 ? "warn" : "bad");
export const scoreColor = (s: number) => (s >= 85 ? "#4ade80" : s >= 65 ? "#f59e0b" : "#ef4444");
