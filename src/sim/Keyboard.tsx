import { useEffect } from "react";
import { useApp } from "../store/app";
import { bus } from "./bus";

const DRIVE_KEYS = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "ShiftLeft", "ShiftRight", "Space"]);
const MECH: Record<string, (typeof bus.manualRequests)[number]> = {
  Space: "intake",
  Digit1: "score_high",
  Digit2: "score_low",
  Digit3: "specimen_high",
  Digit4: "specimen_low",
  KeyX: "drop",
};

const typing = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
};

/** Global keyboard → sim bus. Ignored while typing in the editor or forms. */
export function useKeyboard() {
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (typing(e.target) || e.metaKey || e.ctrlKey) return;
      const app = useApp.getState();
      if (app.mode === "manual") {
        if (DRIVE_KEYS.has(e.code)) e.preventDefault();
        if (!e.repeat && MECH[e.code]) bus.manualRequests.push(MECH[e.code]);
        bus.keys.add(e.code);
        if (app.runState === "idle" && /^(Key[WASDQE]|Arrow)/.test(e.code)) app.run();
      }
      if (e.code === "KeyP" && !e.repeat) {
        if (app.runState === "running") app.pause();
        else if (app.runState === "paused") app.resume();
      }
      if (e.code === "KeyR" && !e.repeat) app.reset();
      if (e.code === "KeyC" && !e.repeat) {
        const order = ["broadcast", "top", "driver", "follow"] as const;
        app.setCamera(order[(order.indexOf(app.camera) + 1) % order.length]);
      }
    };
    const up = (e: KeyboardEvent) => bus.keys.delete(e.code);
    const blur = () => bus.keys.clear();
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);
}
