import { useEffect, useState } from "react"

type State<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: Error }

const cache = new Map<string, unknown>()

export function clearAsyncDataCache(): void {
  cache.clear()
}

export function useAsyncData<T>(fetcher: () => Promise<T>, cacheKey?: string): State<T> {
  const cached = cacheKey !== undefined ? (cache.get(cacheKey) as T | undefined) : undefined
  const [state, setState] = useState<State<T>>(
    cached !== undefined
      ? { status: "success", data: cached, error: undefined }
      : { status: "loading", data: undefined, error: undefined },
  )

  useEffect(() => {
    let cancelled = false
    if (cacheKey === undefined || !cache.has(cacheKey)) {
      setState({ status: "loading", data: undefined, error: undefined })
    }
    fetcher().then(
      (data) => {
        if (cancelled) return
        if (cacheKey !== undefined) cache.set(cacheKey, data)
        setState({ status: "success", data, error: undefined })
      },
      (err: unknown) => {
        if (cancelled) return
        const error = err instanceof Error ? err : new Error(String(err))
        if (cacheKey !== undefined && cache.has(cacheKey)) {
          console.error(`useAsyncData revalidation failed for ${cacheKey}`, error)
          return
        }
        setState({ status: "error", data: undefined, error })
      },
    )
    return () => {
      cancelled = true
    }
  }, [fetcher, cacheKey])

  return state
}
