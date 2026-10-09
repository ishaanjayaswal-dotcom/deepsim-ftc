import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const CHUNKS: [RegExp, string][] = [
  [/node_modules\/(@dimforge|@react-three\/rapier)\//, "physics"],
  [/node_modules\/(@react-three\/(fiber|drei)|three-stdlib|troika)/, "r3f"],
  [/node_modules\/three\//, "three"],
];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5188 },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => CHUNKS.find(([re]) => re.test(id))?.[1],
      },
    },
  },
  test: { environment: "node" },
} as never);
