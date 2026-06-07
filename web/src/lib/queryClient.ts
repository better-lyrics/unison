import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createElement, type ReactNode, useMemo } from "react"

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
      },
    },
  })
}

export interface QueryProviderProps {
  children: ReactNode
  client?: QueryClient
}

export function QueryProvider({ children, client }: QueryProviderProps) {
  const resolved = useMemo(() => client ?? createQueryClient(), [client])
  return createElement(QueryClientProvider, { client: resolved }, children)
}
