import { useEffect, useState } from "react"

type State<T> =
  | { status: "loading"; data: undefined; error: undefined }
  | { status: "success"; data: T; error: undefined }
  | { status: "error"; data: undefined; error: Error }

/** `fetcher` must be referentially stable: a module-level function, or wrapped in useCallback. */
export function useAsyncData<T>(fetcher: () => Promise<T>): State<T> {
  const [state, setState] = useState<State<T>>({ status: "loading", data: undefined, error: undefined })

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading", data: undefined, error: undefined })
    fetcher().then(
      (data) => {
        if (!cancelled) setState({ status: "success", data, error: undefined })
      },
      (err: unknown) => {
        if (!cancelled) {
          setState({
            status: "error",
            data: undefined,
            error: err instanceof Error ? err : new Error(String(err)),
          })
        }
      },
    )
    return () => {
      cancelled = true
    }
  }, [fetcher])

  return state
}
