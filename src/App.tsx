import { Suspense, lazy } from "react";
import { useKeyboard } from "./sim/Keyboard";
import { AnalyticsRail } from "./ui/AnalyticsRail";
import { Sidebar } from "./ui/Sidebar";
import { TopBar } from "./ui/TopBar";
import { ViewportOverlay } from "./ui/ViewportOverlay";

const Scene = lazy(() => import("./sim/Scene").then((m) => ({ default: m.Scene })));

function Loading() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
      <div className="shimmer h-1 w-40 rounded-full bg-white/5" />
      <div className="text-[12px] text-dim">Booting physics world…</div>
    </div>
  );
}

export default function App() {
  useKeyboard();
  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <main className="relative min-w-0 flex-1 bg-ink-950" aria-label="3D simulator viewport">
          <Suspense fallback={<Loading />}>
            <Scene />
          </Suspense>
          <ViewportOverlay />
        </main>
        <AnalyticsRail />
      </div>
    </div>
  );
}
