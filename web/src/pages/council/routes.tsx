import type { RouteObject } from "react-router-dom"
import { CouncilLayout } from "./CouncilLayout"

export const councilRoute = {
  path: "council",
  element: <CouncilLayout />,
  handle: { width: "wide" },
} satisfies RouteObject
