const GROUP = "inline-flex flex-wrap rounded-lg bg-white/[0.02] p-0.5 shadow-[inset_0_0_0_1px_var(--color-unison-border)]"
const SEGMENT =
  "cursor-pointer rounded-md font-medium text-unison-text-muted transition-colors hover:text-unison-text aria-pressed:bg-unison-bg-hover aria-pressed:text-unison-text aria-pressed:shadow-inset-rim"
const SEGMENT_SIZES = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-sm",
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
  size?: keyof typeof SEGMENT_SIZES
}

export function Segmented<T extends string>({ label, value, options, onChange, size = "sm" }: SegmentedProps<T>) {
  return (
    <fieldset aria-label={label} className={GROUP}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`${SEGMENT} ${SEGMENT_SIZES[size]}`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}

interface ToggleSegmentsProps {
  label: string
  options: { key: string; label: string; pressed: boolean; onToggle: () => void }[]
}

export function ToggleSegments({ label, options }: ToggleSegmentsProps) {
  return (
    <fieldset aria-label={label} className={GROUP}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={option.pressed}
          onClick={option.onToggle}
          className={`${SEGMENT} ${SEGMENT_SIZES.sm}`}
        >
          {option.label}
        </button>
      ))}
    </fieldset>
  )
}
