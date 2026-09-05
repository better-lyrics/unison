import { createContext, type ReactNode, useContext } from "react"
import { useAsyncData } from "@/hooks/useAsyncData"
import { fetchBadgeCatalogue } from "@/lib/api"
import type { BadgeCatalogue } from "@/lib/types"

type CatalogueState =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: BadgeCatalogue; error: undefined }
  | { status: "error"; data: undefined; error: Error }

const BadgeCatalogueContext = createContext<CatalogueState | null>(null)

export function BadgeCatalogueProvider({ children }: { children: ReactNode }) {
  const state = useAsyncData<BadgeCatalogue>(fetchBadgeCatalogue, "badges:catalogue")
  return <BadgeCatalogueContext.Provider value={state}>{children}</BadgeCatalogueContext.Provider>
}

export function useBadgeCatalogue(): CatalogueState {
  const ctx = useContext(BadgeCatalogueContext)
  if (ctx === null) {
    throw new Error("useBadgeCatalogue must be used within a BadgeCatalogueProvider")
  }
  return ctx
}
