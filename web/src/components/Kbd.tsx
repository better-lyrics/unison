import { IconCommand } from "@tabler/icons-react"
import { formatKey } from "@/lib/format-key"
import { isMac as platformIsMac } from "@/lib/platform"

interface KbdProps {
  keys: string[]
  isMac?: boolean
}

export function Kbd({ keys, isMac = platformIsMac }: KbdProps) {
  return (
    <span className="inline-flex items-center gap-0.5">
      {keys.map((key) => (
        <span
          key={key}
          className="inline-flex h-4 min-w-4 items-center justify-center rounded bg-current/10 px-1 text-[10px] font-medium leading-none shadow-[0_2px_0_0_rgba(0,0,0,0.3)]"
        >
          {key === "Mod" && isMac ? <IconCommand className="size-2.5" /> : formatKey(key, isMac)}
        </span>
      ))}
    </span>
  )
}
