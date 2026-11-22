import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// GitHub Pages serves the app from /<repo>/; CI sets VITE_BASE accordingly.
export default defineConfig({
  base: process.env.VITE_BASE ?? "/",
  plugins: [react(), tailwindcss()],
  server: { port: 1420 },
  build: { chunkSizeWarningLimit: 2000 },
});
