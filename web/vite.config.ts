import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import type { Plugin } from "vite"
import { defineConfig } from "vitest/config"

// Serves the canonical badge artwork (repo-root assets/badges) at /badge-art during dev only, so
// the seeded /dev previews show real badges without running the API. Dropped from prod builds.
function devBadgeArt(): Plugin {
  const dir = resolve(__dirname, "../assets/badges")
  return {
    name: "unison-dev-badge-art",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/badge-art", (req, res, next) => {
        const name = (req.url ?? "").split("?")[0].replace(/^\//, "")
        if (!/^[a-z0-9_-]+\.svg$/i.test(name)) return next()
        const file = resolve(dir, name)
        if (!file.startsWith(dir) || !existsSync(file)) return next()
        res.setHeader("content-type", "image/svg+xml")
        res.end(readFileSync(file))
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devBadgeArt()],
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
    // The real @number-flow/react needs matchMedia + Web Animations, which happy-dom lacks.
    alias: { "@number-flow/react": resolve(__dirname, "./src/test/number-flow-stub.tsx") },
    // Vitest stubs every .css import to "" unless it is opted in, and that swallows the braccato
    // theme, which is a string handed to the element rather than a stylesheet the page loads.
    css: { include: [/braccato-theme\.css/] },
  },
})
