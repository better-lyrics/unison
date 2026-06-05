import { RouterProvider, createBrowserRouter } from "react-router-dom"
import { AppLayout } from "./components/AppLayout"
import { AboutPage } from "./pages/AboutPage"
import { CuratorsPage } from "./pages/CuratorsPage"
import { DownloadsPage } from "./pages/DownloadsPage"
import { LyricsPage } from "./pages/LyricsPage"
import { MePage } from "./pages/MePage"
import { QueuePage } from "./pages/QueuePage"
import { SearchPage } from "./pages/SearchPage"
import { SongsPage } from "./pages/SongsPage"
import { UserPage } from "./pages/UserPage"

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
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
