import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), basicSsl(), tailwindcss()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  server: {
    host: true,
    https: true,
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/rpc": { target: "http://stellar-localnet:8000", changeOrigin: true },
    },
  },
  test: { environment: "node", exclude: ["e2e/**", "node_modules/**"] },
});
