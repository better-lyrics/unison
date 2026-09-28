import { type BookmarkState, groupByBookmark, neighbour, splitNew } from "@/lib/council-triage"
import type { BookmarkItemType, BookmarkView } from "@/lib/council-types"
import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "react-router-dom"
import { useCouncilEdits, useCouncilOverview, useCouncilQueue } from "./useCouncilData"
import { useBookmarkToggle } from "./useCouncilMutations"
import { useCouncilShortcuts } from "./useCouncilShortcuts"
import { useStoredState } from "./useStoredState"

export interface TriageEntry {
  key: string
  itemType: BookmarkItemType
  itemId: number
}

export type Bookmarkable = { bookmark: BookmarkView | null }

interface UseTriageOptions<T> {
  all: T[] | undefined
  shown: T[]
  entry: (item: T) => TriageEntry
  meKeyId: string
  now: number
}

export function useTriage<T extends Bookmarkable>({ all, shown, entry, meKeyId, now }: UseTriageOptions<T>) {
  const [params, setParams] = useSearchParams()
  const [othersOpen, setOthersOpen] = useState(false)
  const [known, setKnown] = useState<ReadonlySet<string> | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const bookmark = useBookmarkToggle()

  const allKeys = all?.map((item) => entry(item).key)
  useEffect(() => {
    if (known === null && allKeys) setKnown(new Set(allKeys))
  }, [known, allKeys])

  const fresh = known && allKeys ? splitNew(known, allKeys) : []
  const visible = known ? shown.filter((item) => known.has(entry(item).key)) : shown
  const { mine, open, others } = groupByBookmark(visible, meKeyId, now)
  const order = [...mine, ...open, ...(othersOpen ? others : [])].map((item) => entry(item).key)

  const selectedKey = params.get("item")
  const selectedItem = visible.find((item) => entry(item).key === selectedKey) ?? null
  const hrefFor = (key: string) => {
    const next = new URLSearchParams(params)
    next.set("item", key)
    return `?${next.toString()}`
  }
  const select = (key: string | null) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        if (key === null) next.delete("item")
        else next.set("item", key)
        return next
      },
      { replace: true },
    )
    if (key !== null) {
      requestAnimationFrame(() => document.querySelector(`[data-key="${key}"]`)?.scrollIntoView?.({ block: "nearest" }))
    }
  }

  const firstKey = order[0] ?? null
  const autoSelected = useRef(false)
  useEffect(() => {
    if (autoSelected.current || firstKey === null) return
    autoSelected.current = true
    if (selectedKey === null) select(firstKey)
  })

  const [autoAdvance, setAutoAdvance] = useStoredState<"on" | "off">("council.autoAdvance", "on")
  const afterDecision = (key: string) => {
    const at = order.indexOf(key)
    select(autoAdvance === "on" ? (order[at + 1] ?? order[at - 1] ?? null) : null)
  }

  const queue = useCouncilQueue().data
  const edits = useCouncilEdits().data?.items
  const cap = useCouncilOverview().data?.me.bookmarkCap ?? null
  const held = groupByBookmark<{ bookmark: BookmarkView | null }>([...(queue ?? []), ...(edits ?? [])], meKeyId, now)
    .mine.length

  const bookmarkState = (item: T): BookmarkState => {
    const b = item.bookmark
    if (b !== null && b.expiresAt > now) {
      return b.holder.keyId === meKeyId ? { kind: "mine" } : { kind: "other", holder: b.holder.displayName }
    }
    return { kind: "open", capped: cap !== null && held >= cap, cap: cap ?? 0 }
  }

  const toggleBookmark = (item: T) => {
    const e = entry(item)
    bookmark.mutate({ itemType: e.itemType, itemId: e.itemId, bookmark: item.bookmark, meKeyId })
  }

  const heldByOther = (item: T) => {
    const b = item.bookmark
    return b !== null && b.expiresAt > now && b.holder.keyId !== meKeyId
  }

  useCouncilShortcuts({
    j: () => select(neighbour(order, selectedKey, 1)),
    k: () => select(neighbour(order, selectedKey, -1)),
    b: () => {
      if (selectedItem && !heldByOther(selectedItem)) toggleBookmark(selectedItem)
    },
    "/": () => {
      if (!searchRef.current) return false
      searchRef.current.focus()
    },
  })

  return {
    mine,
    open,
    others,
    othersOpen,
    setOthersOpen,
    fresh,
    revealFresh: () => allKeys && setKnown(new Set(allKeys)),
    selectedKey,
    selectedItem,
    select,
    hrefFor,
    afterDecision,
    autoAdvance: autoAdvance === "on",
    setAutoAdvance: (on: boolean) => setAutoAdvance(on ? "on" : "off"),
    cap,
    bookmarkState,
    searchRef,
    toggleBookmark,
    heldByOther,
    bookmarkPending: bookmark.isPending,
  }
}

export type Triage<T extends Bookmarkable> = ReturnType<typeof useTriage<T>>
