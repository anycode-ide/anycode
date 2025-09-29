import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    extensions: [".ts", ".tsx", ".js", ".jsx"],
  },
  assetsInclude: ['**/*.wasm'],
  hot: true,
  build: {
    sourcemap: true,
  }
});
