import { RouterProvider, createBrowserRouter } from "react-router-dom"
import { AppLayout } from "./components/AppLayout"
import { CuratorsPage } from "./pages/CuratorsPage"
import { SongsPage } from "./pages/SongsPage"

const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <SongsPage /> },
      { path: "curators", element: <CuratorsPage /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
