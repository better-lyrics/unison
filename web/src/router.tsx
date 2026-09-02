import { type ComponentType, Suspense, lazy } from "react"
import { type RouteObject, RouterProvider, createBrowserRouter } from "react-router-dom"
import { AppLayout } from "./components/AppLayout"
import { AboutPage } from "./pages/AboutPage"
import { CuratorsPage } from "./pages/CuratorsPage"
import { DocsPage } from "./pages/DocsPage"
import { DownloadsPage } from "./pages/DownloadsPage"
import { LinkPage } from "./pages/LinkPage"
import { LyricsPage } from "./pages/LyricsPage"
import { MePage } from "./pages/MePage"
import { MigratePage } from "./pages/MigratePage"
import { QueuePage } from "./pages/QueuePage"
import { SearchPage } from "./pages/SearchPage"
import { SongsPage } from "./pages/SongsPage"
import { UserPage } from "./pages/UserPage"

// Dev-only state gallery for the link/profile UI. The import.meta.env.DEV branch
// is statically false in production builds, so this whole block (and the lazy
// chunk it references) is dropped from the prod bundle.
const devRoutes: RouteObject[] = []
if (import.meta.env.DEV) {
  const devPages: { path: string; load: () => Promise<{ default: ComponentType }> }[] = [
    { path: "dev", load: () => import("./pages/DevIndex") },
    { path: "dev/link", load: () => import("./pages/DevLinkPreview") },
    { path: "dev/curators", load: () => import("./pages/DevCuratorsPreview") },
    { path: "dev/me", load: () => import("./pages/DevMePreview") },
    { path: "dev/migrate", load: () => import("./pages/DevMigratePreview") },
  ]
  for (const { path, load } of devPages) {
    const Page = lazy(load)
    devRoutes.push({
      path,
      element: (
        <Suspense fallback={null}>
          <Page />
        </Suspense>
      ),
    })
  }
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <SongsPage /> },
      { path: "queue", element: <QueuePage /> },
      { path: "curators", element: <CuratorsPage /> },
      { path: "search", element: <SearchPage /> },
      { path: "song/:videoId", element: <LyricsPage /> },
      { path: "me", element: <MePage /> },
      { path: "curator/:keyId", element: <UserPage /> },
      { path: "about", element: <AboutPage /> },
      { path: "downloads", element: <DownloadsPage /> },
      { path: "docs", element: <DocsPage /> },
      { path: "link", element: <LinkPage /> },
      { path: "migrate", element: <MigratePage /> },
      ...devRoutes,
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
