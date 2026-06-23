import { Suspense, lazy } from "react"
import { type RouteObject, RouterProvider, createBrowserRouter } from "react-router-dom"
import { AppLayout } from "./components/AppLayout"
import { AboutPage } from "./pages/AboutPage"
import { CuratorsPage } from "./pages/CuratorsPage"
import { DownloadsPage } from "./pages/DownloadsPage"
import { LinkPage } from "./pages/LinkPage"
import { LyricsPage } from "./pages/LyricsPage"
import { MePage } from "./pages/MePage"
import { QueuePage } from "./pages/QueuePage"
import { SearchPage } from "./pages/SearchPage"
import { SongsPage } from "./pages/SongsPage"
import { UserPage } from "./pages/UserPage"

// Dev-only state gallery for the link/profile UI. The import.meta.env.DEV branch
// is statically false in production builds, so this whole block (and the lazy
// chunk it references) is dropped from the prod bundle.
const devRoutes: RouteObject[] = []
if (import.meta.env.DEV) {
  const DevLinkPreview = lazy(() => import("./pages/DevLinkPreview"))
  devRoutes.push({
    path: "dev/link",
    element: (
      <Suspense fallback={null}>
        <DevLinkPreview />
      </Suspense>
    ),
  })
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
      { path: "link", element: <LinkPage /> },
      ...devRoutes,
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
