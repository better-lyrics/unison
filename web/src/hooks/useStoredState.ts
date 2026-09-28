import { useCallback, useState } from "react"

export function useStoredState<T extends string>(key: string, fallback: T): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      return (localStorage.getItem(key) as T | null) ?? fallback
    } catch {
      return fallback
    }
  })
  const store = useCallback(
    (next: T) => {
      setValue(next)
      try {
        localStorage.setItem(key, next)
      } catch {
        // storage may be unavailable (private mode); the in-memory value still applies
      }
    },
    [key],
  )
  return [value, store]
}
