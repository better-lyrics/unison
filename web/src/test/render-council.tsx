import { AuthProvider } from "@/auth/AuthProvider"
import { BadgeCatalogueProvider } from "@/components/BadgeCatalogueContext"
import { ToastViewport } from "@/components/ToastViewport"
import { councilRoute } from "@/pages/council/routes"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render } from "@testing-library/react"
import { Outlet, type RouteObject, RouterProvider, createMemoryRouter } from "react-router-dom"

export function renderCouncil(path = "/council", children: RouteObject[] = councilRoute.children) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: (
          <AuthProvider>
            <BadgeCatalogueProvider>
              <Outlet />
              <ToastViewport />
            </BadgeCatalogueProvider>
          </AuthProvider>
        ),
        children: [{ ...councilRoute, children }],
      },
    ],
    { initialEntries: [path] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return { router, client }
}
