import { AuthProvider } from "@/auth/AuthProvider"
import type { BadgeImage } from "@/lib/types"
import { Outlet } from "react-router-dom"
import { AppHeader } from "./AppHeader"
import { BadgeAssetPreloader } from "./BadgeAssetPreloader"
import { BadgeCatalogueProvider } from "./BadgeCatalogueContext"
import { ToastViewport } from "./ToastViewport"

// Stable reference so the preloader effect does not re-run on every render.
const COLOR_VARIANTS: (keyof BadgeImage)[] = ["color"]

export function AppLayout() {
  return (
    <AuthProvider>
      <BadgeCatalogueProvider>
        <BadgeAssetPreloader variants={COLOR_VARIANTS} fetchPriority="high" />
        <div className="min-h-full">
          <AppHeader />
          <main className="mx-auto max-w-5xl px-6 py-8">
            <Outlet />
          </main>
          <ToastViewport />
        </div>
      </BadgeCatalogueProvider>
    </AuthProvider>
  )
}
