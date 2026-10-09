import { CuboidCollider, RigidBody, type IntersectionEnterPayload, type IntersectionExitPayload } from "@react-three/rapier";
import { BASKET, BASKETS, BASKET_TOWER, IN, fieldToWorld, mirror, type Alliance } from "../config/field";
import { bus } from "./bus";
import { ALLIANCE_HEX } from "./fieldTexture";

const W = 0.4; // wall thickness, inches

type Basket = (typeof BASKETS)[number];

function onEnter(b: Basket) {
  return (e: IntersectionEnterPayload) => {
    const h = e.other.rigidBody?.handle;
    const el = h === undefined ? undefined : bus.elements.byHandle.get(h);
    if (el && el.kind === "sample") el.basket = { alliance: b.alliance, level: b.level };
  };
}

function onExit(b: Basket) {
  return (e: IntersectionExitPayload) => {
    const h = e.other.rigidBody?.handle;
    const el = h === undefined ? undefined : bus.elements.byHandle.get(h);
    if (el && el.basket && el.basket.alliance === b.alliance && el.basket.level === b.level) el.basket = null;
  };
}

function BasketBody({ b }: { b: Basket }) {
  const s = BASKET.size;
  const d = BASKET.depth;
  const floorY = b.rim - d;
  const [wx, , wz] = fieldToWorld(b.x, b.y);
  // Which side the field wall is on (red baskets hang off x = 0, blue off x = 144).
  const wallDir = b.alliance === "red" ? -1 : 1;
  const walls: { p: [number, number, number]; s: [number, number, number] }[] = [
    { p: [0, floorY + W / 2, 0], s: [s, W, s] },
    { p: [-(s - W) / 2, floorY + d / 2, 0], s: [W, d, s] },
    { p: [(s - W) / 2, floorY + d / 2, 0], s: [W, d, s] },
    { p: [0, floorY + d / 2, -(s - W) / 2], s: [s, d, W] },
    { p: [0, floorY + d / 2, (s - W) / 2], s: [s, d, W] },
  ];
  const color = ALLIANCE_HEX[b.alliance];
  const armLen = s / 2 + 1.2;

  return (
    <RigidBody type="fixed" colliders={false} position={[wx, 0, wz]} userData={{ kind: "basket", id: b.id }}>
      {walls.map((w, i) => (
        <group key={i}>
          <CuboidCollider args={[(w.s[0] / 2) * IN, (w.s[1] / 2) * IN, (w.s[2] / 2) * IN]} position={[w.p[0] * IN, w.p[1] * IN, w.p[2] * IN]} friction={0.4} restitution={0.05} />
          <mesh position={[w.p[0] * IN, w.p[1] * IN, w.p[2] * IN]} castShadow={i === 0}>
            <boxGeometry args={[w.s[0] * IN, w.s[1] * IN, w.s[2] * IN]} />
            <meshStandardMaterial color="#cbd5e1" transparent opacity={i === 0 ? 0.55 : 0.22} roughness={0.5} metalness={0.1} depthWrite={false} />
          </mesh>
        </group>
      ))}
      {/* scoring sensor */}
      <CuboidCollider
        sensor
        args={[(s / 2 - W) * IN, 2.2 * IN, (s / 2 - W) * IN]}
        position={[0, (floorY + W + 2.2) * IN, 0]}
        onIntersectionEnter={onEnter(b)}
        onIntersectionExit={onExit(b)}
      />
      {/* coloured rim */}
      {[-1, 1].map((k) => (
        <group key={k}>
          <mesh position={[(k * s * IN) / 2, b.rim * IN, 0]}>
            <boxGeometry args={[0.6 * IN, 0.6 * IN, (s + 0.6) * IN]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
          <mesh position={[0, b.rim * IN, (k * s * IN) / 2]}>
            <boxGeometry args={[(s + 0.6) * IN, 0.6 * IN, 0.6 * IN]} />
            <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.6} />
          </mesh>
        </group>
      ))}
      {/* support arm to the perimeter + upright */}
      <mesh position={[wallDir * armLen * 0.5 * IN, (b.rim - 1.5) * IN, 0]} castShadow>
        <boxGeometry args={[armLen * IN, 1 * IN, 1 * IN]} />
        <meshStandardMaterial color="#8a949f" metalness={0.85} roughness={0.3} />
      </mesh>
      <mesh position={[wallDir * (s / 2 + 1.6) * IN, ((b.rim + 12) / 2) * IN, 0]} castShadow>
        <boxGeometry args={[1 * IN, (b.rim - 12) * IN, 1 * IN]} />
        <meshStandardMaterial color="#8a949f" metalness={0.85} roughness={0.3} />
      </mesh>
    </RigidBody>
  );
}

function Tower({ alliance }: { alliance: Alliance }) {
  const p = alliance === "red" ? BASKET_TOWER : { ...BASKET_TOWER, ...mirror(BASKET_TOWER) };
  const [x, , z] = fieldToWorld(p.x, p.y);
  const half = (p.size / 2) * IN;
  return (
    <RigidBody type="fixed" colliders={false} position={[x, 0, z]} userData={{ kind: "tower" }}>
      <CuboidCollider args={[half, (p.height / 2) * IN, half]} position={[0, (p.height / 2) * IN, 0]} />
      <mesh position={[0, (p.height / 2) * IN, 0]} castShadow>
        <boxGeometry args={[p.size * IN, p.height * IN, p.size * IN]} />
        <meshStandardMaterial color="#5b6470" metalness={0.8} roughness={0.35} />
      </mesh>
      <mesh position={[0, p.height * IN + 0.01, 0]}>
        <boxGeometry args={[p.size * IN * 1.1, 0.02, p.size * IN * 1.1]} />
        <meshStandardMaterial color={ALLIANCE_HEX[alliance]} emissive={ALLIANCE_HEX[alliance]} emissiveIntensity={0.8} />
      </mesh>
    </RigidBody>
  );
}

export function Baskets() {
  return (
    <>
      {BASKETS.map((b) => (
        <BasketBody key={b.id} b={b} />
      ))}
      <Tower alliance="red" />
      <Tower alliance="blue" />
    </>
  );
}
