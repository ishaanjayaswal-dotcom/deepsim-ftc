# DSIM · Into The Deep

A browser-based 3D physics simulator for the FIRST Tech Challenge 2024–25 season, *Into The Deep*. You write a Pedro-Pathing-style path, run it on a physical robot in a Rapier world, share it on a community board, and get it graded by a deterministic rule engine.

**Scope:** this is the frontend only. The path repository talks to a REST API defined below. Until that backend exists, it falls back to a browser-local store that follows the same contract, so every feature works now.

```
npm install
npm run dev        # http://localhost:5188
npm test           # parser, profiler, follower rollouts, evaluator
npm run build      # typecheck + production bundle
```

Set `VITE_PATHS_API=http://your-host/api` to point the Community Hub at a real backend.

## Layout

| Region | What it does |
| --- | --- |
| Left sidebar → **Path Editor** | Highlighted JSON/JS editor with inline errors, examples, Format, chain breakdown, **Run** (⌘/Ctrl+Enter) and **Publish Path** |
| Left sidebar → **Community Hub** | Search, filter by strategy, sort by top/new, upvote, edit, copy the data string, delete, **Execute in Simulator** |
| Centre | Three.js + Rapier scene. Camera presets (Broadcast / Top / Driver / Chase), overlay toggles, opponent picker |
| Right rail → **Simulation Advocate** | Overall grade, four metric cards with findings, live telemetry, event log |

Keys: `P` pause, `R` reset, `C` cycle camera. In Driver mode: `WASD` drive (relative to the camera), `Q/E` turn, `Shift` precision, `Space` intake/drop, `1/2` high/low basket, `3/4` high/low chamber.

## Path format

Paste either a bare array of waypoints or an object. The parser also accepts comments, trailing commas, single quotes, unquoted keys, a `const path = …;` wrapper, and base64 data strings copied from the hub.

```jsonc
{
  "name": "4 Sample Auto · Red",
  "alliance": "red",            // red | blue
  "preload": "sample",          // sample | specimen | none
  "constraints": { "maxVel": 62, "maxAccel": 75, "maxDecel": 65, "maxAngVel": 260, "lateralAccel": 90 },
  "path": [
    { "x": 9, "y": 111, "heading": 270 },                                   // start pose
    { "x": 15, "y": 128, "heading": 315, "type": "bezier", "controlPoints": [[21, 115]], "action": "score_high" },
    { "x": 36, "y": 121, "heading": 0, "type": "line", "action": "intake" }
  ]
}
```

- **Coordinates:** Pedro convention. Inches, origin in a field corner, x and y run 0–144. Heading is in degrees, counter-clockwise from +x. Add `"headingUnits": "rad"` to the root to use radians. The red alliance wall is x = 0. Red's net zone and baskets are at (0, 144), and red's observation zone is at (0, 0). The field is rotationally symmetric.
- **Segments:** `type` is `line` or `bezier`. A bezier takes any number of `controlPoints`, which can be `[x, y]` or `{x, y}`. If you give control points without a type, it's treated as a bezier.
- **Heading:** `headingInterpolation` is `linear` (the default, shortest direction), `tangent`, `reverseTangent` or `constant`.
- **Per-waypoint fields:** `maxVel` caps speed on the segment ending at that waypoint. `action`, `wait` (seconds) and `stop` force a full stop. `extend` sets the intake reach in inches.
- **Actions:** `intake`, `intake_sample`, `intake_specimen`, `score_high`, `score_low`, `specimen_high`, `specimen_low`, `park`, `wait`.

**Compilation:** Waypoints between two stops form a *chain*, Pedro's PathChain: the robot flows through them without stopping. Each chain is sampled every 0.5 in along its length. Speed is profiled with a forward/backward pass that limits velocity, acceleration and deceleration, plus curvature limits (lateral acceleration) and heading-rate limits.

## Physics model

- **Robot:** an 18×18 in, 14 kg dynamic body that can only rotate about its vertical axis. Wheel–floor friction is set to zero and the drivetrain is modelled explicitly (`src/sim/drivetrain.ts`):
  - a velocity loop
  - a motor torque–speed curve
  - mecanum strafe efficiency
  - a traction circle at μ·g that drops to kinetic friction once the wheels slip

  The follower (`src/path/follower.ts`) works like Pedro: it projects onto the closest point of the path, drives along the tangent at the profiled speed, and adds translational and centripetal correction plus heading PD. It only outputs the velocity it *wants*. The physics decides what the wheels actually deliver. That's why aggressive profiles or low μ (set in the gear menu) produce real slip and overshoot. The amber parts of the trail show where that happened, and the cyan ghost shows where the plan expected the robot to be.
- **Hive (submersible):** a dynamic body hung on two spring-loaded revolute hinges (pitch and roll, ±2.6°, force-based motors). It rocks when robots hit it or a specimen is clipped on, then settles back to level.
- **Elements:** instanced rigid bodies (one draw call per type) with CCD.
  - Intake makes the element kinematic and fully non-colliding while it's carried.
  - Scoring launches it on a ballistic arc into a basket. The arc picks up the robot's own velocity and a deterministic aim error that grows with distance.
  - Sensors inside each basket count the points.
  - Specimens clip onto the chamber rung and ride the Hive as it tilts.
- **Opponent:** a kinematic replay of a deterministic blue path. It has infinite mass, so it really does shove you.

## Simulation Advocate (`src/eval/advocate.ts`)

A pure function of (path, robot, opponent), so the same input always gives the same report.

| Metric | How it's computed |
| --- | --- |
| Legality | Robot footprint (oriented box) checked at every sample against the field bounds and structure footprints, using the separating axis test. Also checks the start pose touches the alliance wall and the 30 s auto limit. |
| Efficiency | Planned time compared with the hardware minimum (trapezoidal motion at the drivetrain's top speed and peak acceleration). Flags curvature-capped distance, detours, stops with no action, and profiles that ask for more traction than the tiles have. |
| Scoring yield | Replays the action timeline against the real element layout, using the same reach rules as the runtime (`src/lib/rules.ts`), and returns expected points. |
| Defense | Steps the user and opponent poses forward in time to find contacts, contested time (within 8 in), pinch points against structure, and lane crossings. |

The overall grade is a weighted blend of the four: legality 30%, efficiency 20%, yield 30%, defense 20%.

## Path Repository API (for the backend team)

All bodies are JSON. Errors come back as 4xx with `{ "error": "message" }`. Types are in `src/repo/types.ts`.

| Method | Route | Body | Returns |
| --- | --- | --- | --- |
| GET | `/paths?q=&category=&sort=new\|top` | – | `PathRecord[]` |
| GET | `/paths/:id` | – | `PathRecord` |
| POST | `/paths` | `PathDraft` | `201 PathRecord` |
| PATCH | `/paths/:id` | `Partial<PathDraft>` | `PathRecord` |
| DELETE | `/paths/:id` | – | `204` |
| POST | `/paths/:id/upvote` | – | `PathRecord` |

```ts
type PathRecord = {
  id: string;
  name: string;
  teamNumber: number;          // 1–99999
  category: string;            // e.g. "4 Sample Auto", "Specimen Cycle"
  description: string;
  data: string;                // raw path source
  thumbnail: string;           // "x,y x,y …" polyline, normalised to 0–100
  stats: { lengthIn: number; durationS: number; segments: number; grade?: string };
  upvotes: number;
  createdAt: string;           // ISO
  updatedAt: string;
};
```

Suggested Prisma model:

```prisma
model Path {
  id          String   @id @default(cuid())
  name        String
  teamNumber  Int
  category    String
  description String   @default("")
  data        String
  thumbnail   String
  stats       Json
  upvotes     Int      @default(0)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([category])
  @@index([upvotes])
}
```

The server should re-validate `data` by parsing it. `parsePath` in `src/path/parser.ts` has no third-party dependencies, so the backend can import it directly.

## Fidelity notes

- Field dimensions follow the game manual closely but not exactly: the submersible is 44.5 × 29 in, chambers are at 26/13 in, rungs at 20/36 in, and baskets at 43/25.75 in.
- In the real game the baskets sit in the net-zone corners, not on the submersible. This sim keeps them in the corners.
- The Hive's tilt is a deliberate exaggeration for the sim. The real submersible is rigid.
- Hub seed entries use placeholder team numbers.

## Source map

```
src/config     field geometry, robot params, points
src/path       parser, Bezier maths, compiler/profiler, follower, presets + opponents
src/eval       geometry (SAT), Simulation Advocate
src/lib        shared game rules (intake reach, basket shot, chamber, park)
src/sim        R3F scene, Rapier bodies, drivetrain model, score keeper, overlays
src/repo       repository interface, HTTP + local adapters, seed data
src/store      zustand app state
src/ui         dashboard components
```
