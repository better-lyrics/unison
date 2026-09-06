import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react"
import { BadgeModal, type BadgeModalSelection } from "./BadgeModal"

interface BadgeModalApi {
  open: (selection: BadgeModalSelection) => void
}

const NOOP: BadgeModalApi = { open: () => {} }

const Ctx = createContext<BadgeModalApi | null>(null)

// Returns a no-op opener when rendered outside a provider so badge tiles stay
// usable in isolation (e.g. unit tests that render a wall on its own).
export function useBadgeModal(): BadgeModalApi {
  return useContext(Ctx) ?? NOOP
}

export function BadgeModalProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<BadgeModalSelection | null>(null)
  const [closing, setClosing] = useState(false)

  const open = useCallback((next: BadgeModalSelection) => {
    setClosing(false)
    setSelection(next)
  }, [])
  const requestClose = useCallback(() => setClosing(true), [])
  const handleExited = useCallback(() => {
    setSelection(null)
    setClosing(false)
  }, [])

  const api = useMemo(() => ({ open }), [open])

  return (
    <Ctx.Provider value={api}>
      {children}
      {selection ? (
        <BadgeModal
          selection={selection}
          closing={closing}
          onRequestClose={requestClose}
          onExited={handleExited}
        />
      ) : null}
    </Ctx.Provider>
  )
}
