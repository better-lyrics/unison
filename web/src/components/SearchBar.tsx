import { Kbd } from "@/components/Kbd"
import { type DropdownStatus, SearchDropdown } from "@/components/SearchDropdown"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { useSearchShortcut } from "@/hooks/useSearchShortcut"
import { searchLyrics } from "@/lib/api"
import { cn } from "@/lib/cn"
import type { LyricsSearchHit } from "@/lib/types"
import {
  FloatingPortal,
  autoUpdate,
  flip,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
} from "@floating-ui/react"
import { IconSearch, IconX } from "@tabler/icons-react"
import { useQuery } from "@tanstack/react-query"
import { type KeyboardEvent, useEffect, useRef, useState } from "react"
import { useLocation, useNavigate, useSearchParams } from "react-router-dom"

const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200
const MAX_SUGGESTIONS = 5

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
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
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

  useSearchShortcut(inputRef, !compact)

  const suggestQuery = debounced.trim()
  const { data: suggestData, isLoading: suggestLoading } = useQuery({
    queryKey: ["lyrics", "search", "suggest", suggestQuery],
    queryFn: ({ signal }) => searchLyrics({ q: suggestQuery, signal }),
    enabled: open && suggestQuery.length >= MIN_QUERY_LENGTH,
    staleTime: 60_000,
  })
  const results = (suggestData?.results ?? []).slice(0, MAX_SUGGESTIONS)

  const status: DropdownStatus =
    suggestQuery.length < MIN_QUERY_LENGTH
      ? "prompt"
      : suggestLoading
        ? "loading"
        : results.length === 0
          ? "empty"
          : "results"

  const listRef = useRef<Array<HTMLElement | null>>([])
  const { refs, floatingStyles, context } = useFloating<HTMLInputElement>({
    open,
    onOpenChange: setOpen,
    placement: "bottom-end",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip({ padding: 8 }), shift({ padding: 8 })],
  })
  const role = useRole(context, { role: "combobox" })
  const dismiss = useDismiss(context)
  const listNav = useListNavigation(context, {
    listRef,
    activeIndex,
    onNavigate: setActiveIndex,
    virtual: true,
    loop: true,
  })
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions([role, dismiss, listNav])

  const selectHit = (hit: LyricsSearchHit) => {
    setOpen(false)
    setActiveIndex(null)
    navigate(`/song/${hit.videoId}?variantId=${hit.id}`)
  }

  const getRowProps = (index: number, hit: LyricsSearchHit) => ({
    ref(node: HTMLElement | null) {
      listRef.current[index] = node
    },
    ...getItemProps({
      active: activeIndex === index,
      selected: activeIndex === index,
      onClick() {
        selectHit(hit)
      },
    }),
  })

  const onInputKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      const trimmed = e.currentTarget.value.trim()
      if (!e.metaKey && !e.ctrlKey && activeIndex != null && results[activeIndex]) {
        e.preventDefault()
        selectHit(results[activeIndex])
        return
      }
      if (trimmed.length < MIN_QUERY_LENGTH) return
      e.preventDefault()
      setOpen(false)
      navigate(`/search?q=${encodeURIComponent(trimmed)}`)
      return
    }
    if (e.key === "Escape") {
      if (open) {
        setOpen(false)
        return
      }
      setValue("")
      inputRef.current?.blur()
    }
  }

  const onInputChange = (next: string) => {
    setValue(next)
    setActiveIndex(null)
    setOpen(next.trim().length >= 1)
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
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-md border border-transparent text-unison-text transition-colors hover:bg-unison-bg-hover"
      >
        <IconSearch className="size-5 opacity-70" stroke={1.5} aria-hidden="true" />
      </button>
    )
  }

  return (
    <div className={cn("relative", compact ? "w-full" : "w-full max-w-xs")}>
      <div className="flex h-9 items-center gap-2 rounded-md border border-unison-border bg-unison-bg-elevated px-2.5 transition-colors focus-within:border-unison-border-strong hover:border-unison-border-strong">
        <IconSearch className="size-4 shrink-0 text-unison-text opacity-50" stroke={1.5} aria-hidden="true" />
        <input
          ref={(node) => {
            inputRef.current = node
            refs.setReference(node)
          }}
          type="search"
          aria-label="Search lyrics"
          value={value}
          placeholder="Search lyrics"
          className="searchbar-input min-w-0 flex-1 bg-transparent text-sm text-unison-text placeholder:text-unison-text-muted focus:outline-none"
          {...getReferenceProps({
            onChange: (e) => onInputChange((e.target as HTMLInputElement).value),
            onFocus: () => setOpen(value.trim().length >= 1),
            onKeyDown: onInputKeyDown,
          })}
        />
        {value.length === 0 ? (
          <span className="shrink-0 text-unison-text-muted">
            <Kbd keys={["Mod", "/"]} />
          </span>
        ) : null}
        {compact ? (
          <button
            type="button"
            aria-label="Close search"
            onClick={() => {
              setValue("")
              setOpen(false)
              setExpanded(false)
            }}
            className="cursor-pointer rounded p-0.5 text-unison-text transition-colors hover:bg-unison-bg-hover"
          >
            <IconX className="size-4 opacity-50 transition-opacity hover:opacity-100" stroke={1.5} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      {open ? (
        <FloatingPortal>
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            {...getFloatingProps()}
            className="z-50 w-96 overflow-hidden rounded-xl border border-unison-border bg-unison-bg-elevated shadow-[0_16px_40px_-12px_rgba(0,0,0,0.7)]"
          >
            <SearchDropdown status={status} results={results} activeIndex={activeIndex} getRowProps={getRowProps} />
          </div>
        </FloatingPortal>
      ) : null}
    </div>
  )
}
