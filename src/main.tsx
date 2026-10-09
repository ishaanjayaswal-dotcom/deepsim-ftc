import { createRoot } from "react-dom/client";
import App from "./App";
import { bus } from "./sim/bus";
import { useApp } from "./store/app";
import "./index.css";

// Dev-only handle for debugging and automated checks.
if (import.meta.env.DEV) Object.assign(window, { __dsim: { bus, useApp } });

createRoot(document.getElementById("root")!).render(<App />);
