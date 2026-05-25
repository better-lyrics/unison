import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { MemoryRouter } from "react-router-dom"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AuthProvider } from "@/auth/AuthProvider"
import { clearAsyncDataCache } from "@/hooks/useAsyncData"
import { type StoredSession, saveStoredSession } from "@/lib/auth"
import { MePage } from "./MePage"

const ownKeyId = "k".repeat(64)
const valid: StoredSession = {
	sessionToken: "tok",
	keyId: ownKeyId,
	displayName: "BrightVivaceRoll",
	expiresAt: Math.floor(Date.now() / 1000) + 1000,
}

function renderPage() {
	return render(
		<MemoryRouter>
			<AuthProvider>
				<MePage />
			</AuthProvider>
		</MemoryRouter>,
	)
}

beforeEach(() => {
	clearAsyncDataCache()
	localStorage.clear()
	vi.unstubAllGlobals()
})
afterEach(() => {
	cleanup()
	localStorage.clear()
	vi.unstubAllGlobals()
	clearAsyncDataCache()
})

describe("MePage", () => {
	it("shows a sign-in prompt when signed-out", async () => {
		renderPage()
		await waitFor(() => expect(screen.getByText(/not signed in/i)).toBeTruthy())
		expect(screen.getByText(/sign in with better lyrics from the header/i)).toBeTruthy()
	})

	it("renders identity and ranked stats when signed-in and ranked", async () => {
		saveStoredSession(valid)
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((url: string) => {
				if (url === "/auth/me") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								success: true,
								data: {
									keyId: ownKeyId,
									displayName: valid.displayName,
									expiresAt: valid.expiresAt,
								},
							}),
							{ status: 200 },
						),
					)
				}
				if (url === `/leaderboard/users/${ownKeyId}`) {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								success: true,
								data: {
									ranked: true,
									keyId: ownKeyId,
									displayName: valid.displayName,
									reputation: 1.5,
									score: 12.7,
									submissionCount: 5,
									totalUpvotes: 23,
									rank: 7,
								},
							}),
							{ status: 200 },
						),
					)
				}
				return Promise.reject(new Error(`unexpected url ${url}`))
			}),
		)
		renderPage()
		await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
		await waitFor(() => expect(screen.getByText(/#7/)).toBeTruthy())
		expect(screen.getByText("12.7")).toBeTruthy()
		expect(screen.getByText("5")).toBeTruthy()
		expect(screen.getByText("23")).toBeTruthy()
		expect(screen.getByRole("button", { name: /copy key id/i })).toBeTruthy()
	})

	it("renders identity but no stats when signed-in and not ranked", async () => {
		saveStoredSession(valid)
		vi.stubGlobal(
			"fetch",
			vi.fn().mockImplementation((url: string) => {
				if (url === "/auth/me") {
					return Promise.resolve(
						new Response(
							JSON.stringify({
								success: true,
								data: {
									keyId: ownKeyId,
									displayName: valid.displayName,
									expiresAt: valid.expiresAt,
								},
							}),
							{ status: 200 },
						),
					)
				}
				if (url === `/leaderboard/users/${ownKeyId}`) {
					return Promise.resolve(
						new Response(JSON.stringify({ success: true, data: { ranked: false } }), {
							status: 200,
						}),
					)
				}
				return Promise.reject(new Error(`unexpected url ${url}`))
			}),
		)
		renderPage()
		await waitFor(() => expect(screen.getByText(valid.displayName)).toBeTruthy())
		await waitFor(() => expect(screen.getByText(/no leaderboard activity yet/i)).toBeTruthy())
	})
})
