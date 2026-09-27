import type { RouteObject } from "react-router-dom"
import { CouncilEditsPage } from "./CouncilEditsPage"
import { CouncilLayout } from "./CouncilLayout"
import { CouncilOverviewPage } from "./CouncilOverviewPage"
import { CouncilQueuePage } from "./CouncilQueuePage"

export const councilRoute = {
  path: "council",
  element: <CouncilLayout />,
  handle: { width: "wide" },
  children: [
    { index: true, element: <CouncilOverviewPage /> },
    { path: "queue", element: <CouncilQueuePage /> },
    { path: "edits", element: <CouncilEditsPage /> },
  ] as RouteObject[],
} satisfies RouteObject
