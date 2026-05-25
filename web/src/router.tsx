import { RouterProvider, createBrowserRouter } from "react-router-dom"
import { AppLayout } from "./components/AppLayout"
import { AboutPage } from "./pages/AboutPage"
import { CuratorsPage } from "./pages/CuratorsPage"
import { MePage } from "./pages/MePage"
import { SongsPage } from "./pages/SongsPage"
import { UserPage } from "./pages/UserPage"

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <SongsPage /> },
      { path: "curators", element: <CuratorsPage /> },
      { path: "me", element: <MePage /> },
      { path: "users/:keyId", element: <UserPage /> },
      { path: "about", element: <AboutPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
