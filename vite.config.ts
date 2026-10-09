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
  server: {
    port: 5188,
    proxy: {
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => CHUNKS.find(([re]) => re.test(id))?.[1],
      },
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "server/**/*.test.ts"],
  },
} as never);
