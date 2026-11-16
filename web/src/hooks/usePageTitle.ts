import { useEffect } from "react"

export function usePageTitle(title: string | null) {
  useEffect(() => {
    if (title) document.title = title
  }, [title])
}
