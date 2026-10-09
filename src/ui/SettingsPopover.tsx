import { useEffect, useRef } from "react";
import { DEFAULT_ROBOT, type RobotParams } from "../config/robot";
import { useApp } from "../store/app";
import { Button } from "./primitives";

type Field = { key: keyof RobotParams; label: string; min: number; max: number; step: number; unit: string; hint: string; resets?: boolean };

const FIELDS: Field[] = [
  { key: "mu", label: "Tile friction μ", min: 0.3, max: 1.2, step: 0.05, unit: "", hint: "Caps usable force. Drop it to see slip + overshoot." },
  { key: "massKg", label: "Robot mass", min: 6, max: 19, step: 0.5, unit: "kg", hint: "Applied on next reset.", resets: true },
  { key: "freeSpeed", label: "Drive free speed", min: 30, max: 100, step: 1, unit: "in/s", hint: "Motor + gearing top speed." },
  { key: "stallAccel", label: "Peak acceleration", min: 80, max: 400, step: 10, unit: "in/s²", hint: "Motor torque at zero speed." },
  { key: "strafeEfficiency", label: "Strafe efficiency", min: 0.5, max: 1, step: 0.01, unit: "", hint: "Mecanum lateral authority." },
  { key: "driveTau", label: "Velocity loop τ", min: 0.04, max: 0.3, step: 0.01, unit: "s", hint: "Lag of the drive controller." },
  { key: "scoreReach", label: "Dump reach", min: 8, max: 30, step: 1, unit: "in", hint: "Reliable basket scoring range." },
  { key: "intakeReach", label: "Intake reach", min: 3, max: 20, step: 1, unit: "in", hint: "Default extension past the front." },
];

export function SettingsPopover({ onClose }: { onClose: () => void }) {
  const robot = useApp((s) => s.robot);
  const { setRobot, reset } = useApp.getState();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node) && !(e.target as HTMLElement).closest("[aria-label='Physics settings']")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className="rise absolute right-0 top-11 z-50 w-[320px] rounded-xl border border-line-strong bg-ink-850/95 p-4 shadow-2xl backdrop-blur-xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold">Robot & physics</div>
          <div className="text-[11px] text-dim">Live — the Advocate re-scores on change.</div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setRobot(DEFAULT_ROBOT);
            reset();
          }}
        >
          Defaults
        </Button>
      </div>
      <div className="space-y-3">
        {FIELDS.map((f) => {
          const v = robot[f.key] as number;
          return (
            <label key={f.key} className="block">
              <div className="mb-1 flex items-baseline justify-between">
                <span className="text-[12px] text-fg/90">{f.label}</span>
                <span className="font-mono text-[11.5px] tabular text-deep">
                  {v}
                  {f.unit && <span className="text-dim"> {f.unit}</span>}
                </span>
              </div>
              <input
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v}
                onChange={(e) => setRobot({ [f.key]: Number(e.target.value) } as Partial<RobotParams>)}
                onPointerUp={() => f.resets && useApp.getState().runState !== "running" && reset()}
                className="w-full accent-[#22d3ee]"
              />
              <div className="text-[10.5px] text-dim">{f.hint}</div>
            </label>
          );
        })}
      </div>
    </div>
  );
}
