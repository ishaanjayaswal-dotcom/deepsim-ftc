import { Environment, Grid, Lightformer } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Physics } from "@react-three/rapier";
import { Suspense } from "react";
import * as THREE from "three";
import { useApp } from "../store/app";
import { Baskets } from "./Baskets";
import { CameraRig } from "./CameraRig";
import { Field } from "./Field";
import { GameElements } from "./GameElements";
import { Hive } from "./Hive";
import { Opponent } from "./Opponent";
import { EvalMarkers, FollowerTarget, Ghost, OpponentPath, PlannedPath, Trail, Waypoints } from "./Overlays";
import { Robot } from "./Robot";
import { ScoreKeeper } from "./ScoreKeeper";

function World() {
  const simKey = useApp((s) => s.simKey);
  const runState = useApp((s) => s.runState);
  const mode = useApp((s) => s.mode);
  const compiled = useApp((s) => s.compiled);
  const opponent = useApp((s) => s.opponent);
  const evaluation = useApp((s) => s.evaluation);
  const show = useApp((s) => s.show);
  // Physics content is keyed on simKey: Run/Reset rebuilds a clean world from the current path.
  const alliance = compiled?.spec.alliance ?? "red";
  const preload = mode === "auto" ? (compiled?.spec.preload ?? "none") : "none";

  return (
    <>
      <Physics key={simKey} gravity={[0, -9.81, 0]} timeStep={1 / 120} paused={runState === "paused"} interpolate>
        <Field />
        <Hive />
        <Baskets />
        <GameElements alliance={alliance} preload={preload} />
        <Robot />
        {opponent && <Opponent path={opponent} />}
        <ScoreKeeper alliance={alliance} />
      </Physics>

      {compiled && show.path && mode === "auto" && (
        <>
          <PlannedPath path={compiled} />
          <Waypoints path={compiled} />
        </>
      )}
      {compiled && show.ghost && mode === "auto" && <Ghost path={compiled} />}
      {opponent && show.opponentPath && <OpponentPath path={opponent} />}
      {show.trail && <Trail />}
      {mode === "auto" && <FollowerTarget />}
      {evaluation && show.markers && mode === "auto" && <EvalMarkers markers={evaluation.markers} />}
    </>
  );
}

function Lights() {
  return (
    <>
      <hemisphereLight args={["#c7dbff", "#0b0b0d", 0.45]} />
      <directionalLight
        position={[2.2, 5.2, 2.6]}
        intensity={2.4}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-2.4}
        shadow-camera-right={2.4}
        shadow-camera-top={2.4}
        shadow-camera-bottom={-2.4}
        shadow-camera-near={0.5}
        shadow-camera-far={12}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      {/* alliance-coloured rim lights */}
      <pointLight position={[-3.2, 1.6, 0]} color="#ff4d4f" intensity={6} distance={6} decay={1.6} />
      <pointLight position={[3.2, 1.6, 0]} color="#3b82f6" intensity={6} distance={6} decay={1.6} />
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={2.2} position={[0, 4, 0]} rotation-x={Math.PI / 2} scale={[6, 6, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#9ecbff" position={[-4, 2, 2]} rotation-y={Math.PI / 2} scale={[4, 2, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#ffd6a8" position={[4, 2, -2]} rotation-y={-Math.PI / 2} scale={[4, 2, 1]} />
      </Environment>
    </>
  );
}

export function Scene() {
  return (
    <Canvas
      shadows
      dpr={[1, 2]}
      camera={{ position: [-0.35, 4.1, 4.55], fov: 40, near: 0.05, far: 60 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: "high-performance" }}
    >
      <color attach="background" args={["#0A0A0B"]} />
      <fog attach="fog" args={["#0A0A0B", 7, 16]} />
      <Lights />
      <Suspense fallback={null}>
        <World />
      </Suspense>
      <Grid
        position={[0, -0.002, 0]}
        args={[30, 30]}
        cellSize={0.3048}
        cellThickness={0.6}
        cellColor="#1a1c20"
        sectionSize={1.8288}
        sectionThickness={1}
        sectionColor="#23262c"
        fadeDistance={14}
        fadeStrength={1.5}
        infiniteGrid
      />
      <CameraRig />
    </Canvas>
  );
}
