/** Starter paths for an empty hub. Shared by the browser-local store and the server's first boot. */
import { PRESETS, presetSource } from "../path/presets";

export type SeedPath = {
  name: string;
  teamNumber: number;
  category: string;
  description: string;
  data: string;
  upvotes: number;
  daysAgo: number;
};

const fromPreset = (preset: string, teamNumber: number, description: string, upvotes: number, daysAgo: number): SeedPath => {
  const def = PRESETS.find((p) => p.id === preset)!;
  return { name: (def.body.name as string) ?? def.id, teamNumber, category: def.category, description, data: presetSource(preset), upvotes, daysAgo };
};

export const SEED_PATHS: SeedPath[] = [
  fromPreset("four-sample", 31415, "Preload + 3 spikes. Backs into the basket at 315°, flows the pickups with a single control point.", 42, 2),
  fromPreset("specimen-cycle", 27182, "Three high-chamber clips with two human-player grabs. Bezier returns keep the chamber approach square.", 37, 4),
  fromPreset("hive-raid", 16180, "Colour-sorted sub intake with a 16 in extension — two raids, both into the high basket.", 29, 6),
  fromPreset("stress", 14142, "Tuning fixture. Run it at μ 0.5 to see the follower lose traction and overshoot the stop.", 12, 9),
  {
    // A park-only starter so the board has a beginner example.
    name: "Safe Park · Red",
    teamNumber: 17320,
    category: "Park Only",
    description: "Three points, zero risk. A rookie-friendly starting template.",
    data: `{
  "name": "Safe Park · Red",
  "alliance": "red",
  "preload": "none",
  "path": [
    { "x": 9, "y": 40, "heading": 0 },
    { "x": 12, "y": 13, "heading": 0, "type": "bezier", "controlPoints": [[24, 30]], "action": "park" }
  ]
}`,
    upvotes: 8,
    daysAgo: 12,
  },
];
