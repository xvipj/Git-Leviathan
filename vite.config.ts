import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri works best with a fixed dev port and no automatic browser opening.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          xterm: ["@xterm/xterm", "@xterm/addon-fit"],
          highlight: ["highlight.js/lib/common"],
          icons: ["lucide-react"],
        },
      },
    },
  },
});
