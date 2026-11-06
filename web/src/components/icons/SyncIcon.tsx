import type { SyncKind } from "@/lib/sync-type"

const HALF = 0.5

const BAR_OPACITY: Record<SyncKind, [number, number, number]> = {
  syllable: [HALF, 1, HALF],
  word: [HALF, 1, 1],
  line: [1, 1, 1],
  unsynced: [HALF, HALF, HALF],
}

interface SyncIconProps {
  kind: SyncKind
  size?: number
  className?: string
}

export function SyncIcon({ kind, size = 16, className }: SyncIconProps) {
  const [a, b, c] = BAR_OPACITY[kind]
  return (
    <svg
      viewBox="0 0 1024 1024"
      width={size}
      height={size}
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <rect x="636" y="239" width="389.981" height="233.271" rx="48" fillOpacity={a} />
      <path
        fillOpacity={b}
        d="M0 335C0 289.745 0 267.118 14.0589 253.059C28.1177 239 50.7452 239 96 239H213C243.17 239 258.255 239 267.627 248.373C277 257.745 277 272.83 277 303V408C277 438.17 277 453.255 267.627 462.627C258.255 472 243.17 472 213 472H96C50.7452 472 28.1177 472 14.0589 457.941C0 443.882 0 421.255 0 376V335Z"
      />
      <path
        fillOpacity={c}
        d="M337 304C337 273.83 337 258.745 346.373 249.373C355.745 240 370.83 240 401 240H460C505.255 240 527.882 240 541.941 254.059C556 268.118 556 290.745 556 336V377C556 422.255 556 444.882 541.941 458.941C527.882 473 505.255 473 460 473H401C370.83 473 355.745 473 346.373 463.627C337 454.255 337 439.17 337 409V304Z"
      />
      <rect y="552.271" width="1024" height="233" rx="48" fillOpacity={HALF} />
    </svg>
  )
}
