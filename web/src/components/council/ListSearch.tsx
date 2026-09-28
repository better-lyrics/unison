import { Kbd } from "@/components/Kbd"
import { cn } from "@/lib/cn"
import { IconSearch } from "@tabler/icons-react"
import type { Ref } from "react"

interface ListSearchProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  ref?: Ref<HTMLInputElement>
  className?: string
}

export function ListSearch({ value, onChange, placeholder, ref, className }: ListSearchProps) {
  return (
    <label
      className={cn(
        "flex h-8 items-center gap-2 rounded-md border border-unison-border bg-unison-bg-elevated px-2.5 transition-colors focus-within:border-unison-border-strong hover:border-unison-border-strong",
        className,
      )}
    >
      <IconSearch aria-hidden className="size-3.5 text-unison-text opacity-50" stroke={1.5} />
      <input
        ref={ref}
        type="search"
        aria-label="Search this list"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") e.currentTarget.blur()
        }}
        placeholder={placeholder}
        className="min-w-0 flex-1 border-0 bg-transparent text-[13px] outline-none placeholder:text-unison-text-muted [&::-webkit-search-cancel-button]:hidden"
      />
      <Kbd keys={["/"]} className="text-unison-text-muted" />
    </label>
  )
}

export const fieldClass =
  "h-8 cursor-pointer appearance-none rounded-md border border-unison-border bg-unison-bg-elevated bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23f5f5f7' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E\")] bg-[length:14px] bg-[right_8px_center] bg-no-repeat pr-7 pl-2.5 text-[13px] text-unison-text transition-colors outline-none hover:border-unison-border-strong focus:border-unison-border-strong"
