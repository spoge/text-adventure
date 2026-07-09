import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/text-adventure/",
  build: {
    outDir: "build",
    sourcemap: false,
  },
  plugins: [react()],
});
