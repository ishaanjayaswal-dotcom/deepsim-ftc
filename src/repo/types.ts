/** Wire format shared with the backend (see README → "Path Repository API"). */

export const STRATEGY_CATEGORIES = [
  "4 Sample Auto",
  "Specimen Cycle",
  "Submersible Cycle",
  "Sample + Specimen Hybrid",
  "Park Only",
  "Defense",
  "Bezier Stress Test",
] as const;

export type StrategyCategory = (typeof STRATEGY_CATEGORIES)[number] | string;

export type PathStats = { lengthIn: number; durationS: number; segments: number; grade?: string; alliance?: "red" | "blue" };

export type PathRecord = {
  id: string;
  name: string;
  teamNumber: number;
  category: StrategyCategory;
  description: string;
  /** Raw path source as published (JSON / relaxed JSON). */
  data: string;
  /** Normalised 0..100 polyline "x,y x,y ..." for the card thumbnail. */
  thumbnail: string;
  stats: PathStats;
  upvotes: number;
  createdAt: string;
  updatedAt: string;
};

/** List rows leave out the path source so the hub stays light; fetch the full record to run or edit it. */
export type PathSummary = Omit<PathRecord, "data">;
export type PathDraft = Omit<PathRecord, "id" | "createdAt" | "updatedAt" | "upvotes">;
export type PathPatch = Partial<Omit<PathRecord, "id" | "createdAt">>;
/** POST /paths answers with the record plus a one-time edit key. */
export type CreatedPathRecord = PathRecord & { editKey?: string };

export type ListQuery = { q?: string; category?: string; sort?: "new" | "top" };

export interface PathRepository {
  readonly kind: "http" | "local" | "pending";
  list(query?: ListQuery): Promise<PathSummary[]>;
  get(id: string): Promise<PathRecord>;
  create(draft: PathDraft): Promise<PathRecord>;
  update(id: string, patch: PathPatch): Promise<PathRecord>;
  remove(id: string): Promise<void>;
  upvote(id: string): Promise<PathRecord>;
  /** True when this browser may edit or delete the path (it published it, or the store is local). */
  canEdit(id: string): boolean;
  /** True when this browser has already upvoted the path. */
  hasVoted(id: string): boolean;
}
