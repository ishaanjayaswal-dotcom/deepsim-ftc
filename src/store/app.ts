import { create } from "zustand";
import { DEFAULT_ROBOT, POINTS, type RobotParams } from "../config/robot";
import { evaluatePath, type Evaluation } from "../eval/advocate";
import type { ParkResult } from "../lib/rules";
import { compilePath } from "../path/compile";
import { parsePath } from "../path/parser";
import { DEFAULT_SOURCE, opponentSpec, type OpponentId } from "../path/presets";
import type { CompiledPath, ParseIssue } from "../path/types";
import { resetBus } from "../sim/bus";

export type SimMode = "auto" | "manual";
export type RunState = "idle" | "running" | "paused" | "finished";
export type CameraMode = "broadcast" | "top" | "follow" | "driver";
export type SidebarTab = "editor" | "hub";

export type Score = {
  highBasket: number;
  lowBasket: number;
  netZone: number;
  highChamber: number;
  lowChamber: number;
  park: ParkResult;
  total: number;
};

export const EMPTY_SCORE: Score = { highBasket: 0, lowBasket: 0, netZone: 0, highChamber: 0, lowChamber: 0, park: null, total: 0 };

export const scoreTotal = (s: Omit<Score, "total">) =>
  s.highBasket * POINTS.highBasket +
  s.lowBasket * POINTS.lowBasket +
  s.netZone * POINTS.netZone +
  s.highChamber * POINTS.highChamber +
  s.lowChamber * POINTS.lowChamber +
  (s.park ? POINTS.observationPark : 0);

export type SimEvent = { id: number; t: number; kind: "score" | "miss" | "contact" | "info" | "slip" | "intake"; text: string; points?: number };

export type ActivePath = { origin: "editor" | "community"; recordId?: string; teamNumber?: number };

type State = {
  source: string;
  issues: ParseIssue[];
  compiled: CompiledPath | null;
  opponentId: OpponentId;
  opponent: CompiledPath | null;
  evaluation: Evaluation | null;
  evaluating: boolean;
  evalNonce: number;
  active: ActivePath;

  mode: SimMode;
  runState: RunState;
  simKey: number;
  camera: CameraMode;
  tab: SidebarTab;
  robot: RobotParams;
  show: { path: boolean; trail: boolean; opponentPath: boolean; markers: boolean; ghost: boolean };

  score: Score;
  events: SimEvent[];
  toast: { id: number; text: string; tone: "good" | "bad" | "info" } | null;
  hubNonce: number;

  setSource: (s: string) => void;
  applySource: (opts?: { reset?: boolean }) => void;
  loadPath: (source: string, active: ActivePath) => void;
  setOpponent: (id: OpponentId) => void;
  setMode: (m: SimMode) => void;
  run: () => void;
  pause: () => void;
  resume: () => void;
  reset: () => void;
  finish: () => void;
  setCamera: (c: CameraMode) => void;
  setTab: (t: SidebarTab) => void;
  setRobot: (p: Partial<RobotParams>) => void;
  toggleShow: (k: keyof State["show"]) => void;
  setScore: (s: Score) => void;
  pushEvent: (e: Omit<SimEvent, "id">) => void;
  showToast: (text: string, tone?: "good" | "bad" | "info") => void;
  bumpHub: () => void;
};

let eventId = 0;

function analyse(source: string, opponentId: OpponentId, robot: RobotParams) {
  const { spec, issues } = parsePath(source);
  if (!spec) return { issues, compiled: null, opponent: null, evaluation: null };
  const compiled = compilePath(spec);
  const oppSpec = opponentSpec(opponentId, spec);
  const opponent = oppSpec ? compilePath(oppSpec) : null;
  const evaluation = evaluatePath(compiled, robot, opponent);
  return { issues, compiled, opponent, evaluation };
}

const initial = analyse(DEFAULT_SOURCE, "raider", DEFAULT_ROBOT);

export const useApp = create<State>((set, get) => ({
  source: DEFAULT_SOURCE,
  issues: initial.issues,
  compiled: initial.compiled,
  opponentId: "raider",
  opponent: initial.opponent,
  evaluation: initial.evaluation,
  evaluating: false,
  evalNonce: 0,
  active: { origin: "editor" },

  mode: "auto",
  runState: "idle",
  simKey: 0,
  camera: "broadcast",
  tab: "editor",
  robot: DEFAULT_ROBOT,
  show: { path: true, trail: true, opponentPath: true, markers: true, ghost: true },

  score: EMPTY_SCORE,
  events: [],
  toast: null,
  hubNonce: 0,

  setSource: (source) => set({ source }),

  applySource: ({ reset = true } = {}) => {
    const { source, opponentId, robot, runState } = get();
    const r = analyse(source, opponentId, robot);
    set({ issues: r.issues });
    if (!r.compiled) return;
    set({ compiled: r.compiled, opponent: r.opponent, evaluation: r.evaluation, evalNonce: get().evalNonce + 1 });
    if (reset && runState !== "running") get().reset();
  },

  loadPath: (source, active) => {
    set({ source, active, mode: "auto" });
    get().applySource({ reset: false });
    if (get().compiled) get().run();
  },

  setOpponent: (opponentId) => {
    set({ opponentId });
    get().applySource();
  },

  setMode: (mode) => {
    set({ mode });
    get().reset();
  },

  run: () => {
    resetBus();
    set((s) => ({ runState: "running", simKey: s.simKey + 1, score: EMPTY_SCORE, events: [] }));
    get().pushEvent({ t: 0, kind: "info", text: get().mode === "auto" ? "Autonomous started" : "Driver control — WASD to drive" });
  },
  pause: () => set({ runState: "paused" }),
  resume: () => set({ runState: "running" }),
  reset: () => {
    resetBus();
    set((s) => ({ runState: "idle", simKey: s.simKey + 1, score: EMPTY_SCORE, events: [] }));
  },
  finish: () => set({ runState: "finished" }),

  setCamera: (camera) => set({ camera }),
  setTab: (tab) => set({ tab }),
  setRobot: (p) => {
    set((s) => ({ robot: { ...s.robot, ...p } }));
    const { compiled, opponent, robot } = get();
    if (compiled) set({ evaluation: evaluatePath(compiled, robot, opponent), evalNonce: get().evalNonce + 1 });
  },
  toggleShow: (k) => set((s) => ({ show: { ...s.show, [k]: !s.show[k] } })),
  setScore: (score) => set({ score }),
  pushEvent: (e) => set((s) => ({ events: [{ ...e, id: ++eventId }, ...s.events].slice(0, 60) })),
  showToast: (text, tone = "info") => set({ toast: { id: ++eventId, text, tone } }),
  bumpHub: () => set((s) => ({ hubNonce: s.hubNonce + 1 })),
}));
