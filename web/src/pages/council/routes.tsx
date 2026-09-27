import type { RouteObject } from "react-router-dom"
import { CouncilLayout } from "./CouncilLayout"
import { CouncilOverviewPage } from "./CouncilOverviewPage"

export const councilRoute = {
  path: "council",
  element: <CouncilLayout />,
  handle: { width: "wide" },
  children: [{ index: true, element: <CouncilOverviewPage /> }] as RouteObject[],
} satisfies RouteObject
