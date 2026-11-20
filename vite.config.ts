import { defineConfig } from "vite";
export default defineConfig({
  root: "web",
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    proxy: { "/api": `http://127.0.0.1:${process.env.API_PORT || "3000"}` },
  },
});
