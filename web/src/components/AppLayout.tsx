import { AuthProvider } from "@/auth/AuthProvider"
import { Outlet } from "react-router-dom"
import { AppHeader } from "./AppHeader"
import { ToastViewport } from "./ToastViewport"

export function AppLayout() {
	return (
		<AuthProvider>
			<div className="min-h-full">
				<AppHeader />
				<main className="mx-auto max-w-5xl px-6 py-8">
					<Outlet />
				</main>
				<ToastViewport />
			</div>
		</AuthProvider>
	)
}
