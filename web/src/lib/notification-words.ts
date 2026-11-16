import type { NotificationGroup, NotificationItem, NotificationKind } from "./types"

export interface NotificationPart {
  text: string
  strong?: boolean
}

export interface NotificationWords {
  parts: NotificationPart[]
  href: string | null
  pending: boolean
}

export const NOTIFICATIONS_TITLE = "Notifications"

export const newCountLabel = (count: number) => `${count} new`

export const NOTIFICATIONS_EMPTY = {
  title: "Nothing here yet",
  body: "When someone suggests an edit to your lyrics, or decides on a suggestion you sent, it shows up here.",
}

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroup, string> = {
  lyrics: "On your lyrics",
  suggestions: "Your suggestions",
}

const COUNCIL = "The council"
const SOMEONE = "Someone"
const A_LYRIC = "a lyric"

const strong = (text: string): NotificationPart => ({ text, strong: true })

const liveTail = (item: NotificationItem): NotificationPart[] =>
  item.data.revNo === undefined ? [{ text: "." }] : [{ text: `. Rev ${item.data.revNo} is live.` }]

function song(item: NotificationItem): NotificationPart {
  return item.song ? strong(item.song.song) : { text: A_LYRIC }
}

function author(item: NotificationItem): NotificationPart {
  return strong(item.actor?.displayName ?? SOMEONE)
}

function decider(item: NotificationItem): NotificationPart {
  return strong(item.data.decidedBy === "council" || !item.actor ? COUNCIL : item.actor.displayName)
}

export const NOTIFICATION_WORDS: Record<NotificationKind, (item: NotificationItem) => NotificationPart[]> = {
  suggestion_new: (item) => [author(item), { text: " suggested an edit to " }, song(item), { text: "." }],
  suggestion_deadline: (item) => [
    { text: "You have 1 day left to decide on " },
    author(item),
    { text: "'s suggestion for " },
    song(item),
    { text: ". After that, the council can too." },
  ],
  suggestion_council_decided: (item) =>
    item.data.outcome === "rejected"
      ? [
          strong(COUNCIL),
          { text: " rejected " },
          author(item),
          { text: "'s suggestion for " },
          song(item),
          { text: "." },
        ]
      : [
          strong(COUNCIL),
          { text: " approved " },
          author(item),
          { text: "'s suggestion for " },
          song(item),
          ...liveTail(item),
        ],
  suggestion_approved: (item) => [
    decider(item),
    { text: " approved your suggestion for " },
    song(item),
    ...liveTail(item),
  ],
  suggestion_rejected: (item) => [decider(item), { text: " rejected your suggestion for " }, song(item), { text: "." }],
}

export function notificationWords(item: NotificationItem): NotificationWords {
  const pending = item.refStatus === "pending"
  const href = item.song
    ? pending
      ? `/song/${item.song.videoId}?suggestion=${item.data.revisionId}`
      : `/song/${item.song.videoId}`
    : null
  return { parts: NOTIFICATION_WORDS[item.kind](item), href, pending }
}
