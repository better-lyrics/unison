import { defineConfig } from "vitest/config"

export default defineConfig({
	test: {
		globals: true,
		environment: "node",
		include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
		// eld is dynamically imported at runtime only. If a test ever calls
		// loadEld(), externalize prevents vitest from pre-bundling the 4.4 MB
		// ngrams file via Vite's optimizer.
		server: {
			deps: {
				external: [/^eld/],
			},
		},
		coverage: {
			provider: "v8",
			reporter: ["text", "json", "html"],
			include: ["src/**/*.ts"],
			exclude: ["src/**/*.test.ts", "src/index.ts"],
		},
	},
	resolve: {
		alias: {
			"@": "/src",
		},
	},
})
