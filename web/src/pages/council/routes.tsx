import type { RouteObject } from "react-router-dom"
import { CouncilActivityPage } from "./CouncilActivityPage"
import { CouncilApplicantsPage } from "./CouncilApplicantsPage"
import { CouncilBookmarksPage } from "./CouncilBookmarksPage"
import { CouncilEditsPage } from "./CouncilEditsPage"
import { CouncilLayout } from "./CouncilLayout"
import { CouncilMembersPage } from "./CouncilMembersPage"
import { CouncilMetadataPage } from "./CouncilMetadataPage"
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
    { path: "metadata", element: <CouncilMetadataPage /> },
    { path: "bookmarks", element: <CouncilBookmarksPage /> },
    { path: "applicants", element: <CouncilApplicantsPage /> },
    { path: "activity", element: <CouncilActivityPage /> },
    { path: "members", element: <CouncilMembersPage /> },
  ] as RouteObject[],
} satisfies RouteObject
