import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const buildVersion = `dp-build-${Date.now().toString(36)}`;

export default defineConfig({
  server: { allowedHosts: true },
  root: path.resolve(dirname, "client"),
  plugins: [react(), {
    name: "dogs-planet-pwa-release",
    apply: "build",
    writeBundle() {
      // Anche se cambia soltanto un bundle, il browser rileva il nuovo worker.
      const worker = path.resolve(dirname, "dist/public/sw.js");
      fs.writeFileSync(worker, fs.readFileSync(worker, "utf8").replace('"dp-v6-updates"', JSON.stringify(buildVersion)));
    },
  }],
  resolve: {
    alias: {
      "@": path.resolve(dirname, "client/src"),
      "@shared": path.resolve(dirname, "shared"),
    },
  },
  build: {
    outDir: path.resolve(dirname, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
});
