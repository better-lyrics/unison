import { IconSearch, IconX } from "@tabler/icons-react"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { cn } from "@/lib/cn"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200

interface SearchBarProps {
  compact?: boolean
}

export function SearchBar({ compact = false }: SearchBarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const onSearchRoute = location.pathname === "/search"

  const urlQ = searchParams.get("q") ?? ""
  const initial = onSearchRoute ? urlQ : ""
  const [value, setValue] = useState(initial)
  const [expanded, setExpanded] = useState(!compact)
  const debounced = useDebouncedValue(value, DEBOUNCE_MS)
  const lastUrlQRef = useRef(urlQ)
  const urlQRef = useRef(urlQ)
  const searchParamsRef = useRef(searchParams)
  const setSearchParamsRef = useRef(setSearchParams)
  const onSearchRouteRef = useRef(onSearchRoute)
  urlQRef.current = urlQ
  searchParamsRef.current = searchParams
  setSearchParamsRef.current = setSearchParams
  onSearchRouteRef.current = onSearchRoute

  useEffect(() => {
    if (!onSearchRoute) {
      lastUrlQRef.current = urlQ
      return
    }
    if (urlQ !== lastUrlQRef.current) {
      lastUrlQRef.current = urlQ
      setValue(urlQ)
    }
  }, [onSearchRoute, urlQ])

  useEffect(() => {
    if (!onSearchRouteRef.current) return
    if (debounced === urlQRef.current) return
    const next = new URLSearchParams(searchParamsRef.current)
    if (debounced.length > 0) next.set("q", debounced)
    else next.delete("q")
    lastUrlQRef.current = debounced
    setSearchParamsRef.current(next, { replace: true })
  }, [debounced])

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const trimmed = e.currentTarget.value.trim()
      if (trimmed.length < MIN_QUERY_LENGTH) return
      navigate(`/search?q=${encodeURIComponent(trimmed)}`)
      return
    }
    if (e.key === "Escape") {
      setValue("")
      inputRef.current?.blur()
    }
  }

  if (compact && !expanded) {
    return (
      <button
        type="button"
        aria-label="Open search"
        onClick={() => {
          setExpanded(true)
          window.setTimeout(() => inputRef.current?.focus(), 0)
        }}
        className="cursor-pointer rounded-md p-1.5 text-unison-text-secondary transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
      >
        <IconSearch className="size-5" stroke={1.5} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-unison-border bg-unison-bg-elevated px-2.5 py-1.5 transition-colors focus-within:border-unison-border-strong hover:border-unison-border-strong",
        compact ? "w-full" : "w-full max-w-xs",
      )}
    >
      <IconSearch className="size-4 shrink-0 text-unison-text-muted" stroke={1.5} aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        aria-label="Search lyrics"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder="Search lyrics"
        className="min-w-0 flex-1 bg-transparent text-sm text-unison-text placeholder:text-unison-text-muted focus:outline-none"
      />
      {compact ? (
        <button
          type="button"
          aria-label="Close search"
          onClick={() => {
            setValue("")
            setExpanded(false)
          }}
          className="cursor-pointer rounded p-0.5 text-unison-text-muted transition-colors hover:bg-unison-bg-hover hover:text-unison-text"
        >
          <IconX className="size-4" stroke={1.5} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  )
}
