import { AuthProvider } from "@/auth/AuthProvider"
import { cn } from "@/lib/cn"
import { pageWidthClass, usePageWidth } from "@/lib/page-width"
import { useArtChrome } from "@/lib/route-chrome"
import type { BadgeImage } from "@/lib/types"
import { Outlet } from "react-router-dom"
import { AppHeader } from "./AppHeader"
import { BadgeAssetPreloader } from "./BadgeAssetPreloader"
import { BadgeCatalogueProvider } from "./BadgeCatalogueContext"
import { ToastViewport } from "./ToastViewport"

// Stable reference so the preloader effect does not re-run on every render.
const COLOR_VARIANTS: (keyof BadgeImage)[] = ["color"]

export function AppLayout() {
  const width = usePageWidth()
  const art = useArtChrome()
  return (
    <AuthProvider>
      <BadgeCatalogueProvider>
        <BadgeAssetPreloader variants={COLOR_VARIANTS} fetchPriority="high" />
        <div className="min-h-full">
          <AppHeader width={width} />
          <main className={cn("mx-auto py-8", art && "overflow-x-clip", pageWidthClass(width))}>
            <Outlet />
          </main>
          <ToastViewport />
        </div>
      </BadgeCatalogueProvider>
    </AuthProvider>
  )
}
