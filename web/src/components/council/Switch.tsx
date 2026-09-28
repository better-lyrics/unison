interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  children: string
}

export function Switch({ checked, onChange, children }: SwitchProps) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        aria-checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="relative m-0 h-4 w-7 cursor-pointer appearance-none rounded-full bg-white/[0.14] transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-3 after:rounded-full after:bg-unison-text after:transition-transform after:duration-200 after:ease-[cubic-bezier(0.2,0,0,1)] after:content-[''] checked:bg-[#5865f2] checked:after:translate-x-3"
      />
      {children}
    </label>
  )
}
