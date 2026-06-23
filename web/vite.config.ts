import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  server: {
    proxy: {
      "/leaderboard": "http://localhost:3000",
      "/lyrics": "http://localhost:3000",
      "/feed": "http://localhost:3000",
      "/requests": "http://localhost:3000",
      "/auth": "http://localhost:3000",
      "/links": "http://localhost:3000",
      "/health": "http://localhost:3000",
    },
  },
  test: {
    environment: "happy-dom",
    globals: false,
  },
})
