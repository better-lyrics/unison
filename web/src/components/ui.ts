// Borderless translucent panel: the standard container surface across the SPA. Structure comes
// from the fill and surrounding whitespace, not a border.
export const panelClass = "rounded-lg bg-white/[0.02]"

// Panels that hold controls or editable content also want inner padding and vertical rhythm.
export const editableCardClass = `${panelClass} space-y-3 p-4`

export const artTextShadowClass = "[text-shadow:0_1px_16px_rgba(0,0,0,0.3)]"
export const artClippedTextShadowClass = "[text-shadow:none] drop-shadow-[0_1px_16px_rgba(0,0,0,0.3)]"

export const artPageClass = `[--color-unison-text-muted:var(--ink-3)] [--color-unison-text-secondary:var(--ink-2)] ${artTextShadowClass}`

export const glassClass =
  "bg-[rgba(15,14,19,0.28)] shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06)] backdrop-saturate-150"

export const glassActionClass = `${glassClass} inline-flex h-11 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-full px-[18px] text-sm font-bold text-unison-text transition-[background-color,scale] duration-150 ease-out hover:bg-white/[0.14] active:not-disabled:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-60`

const CHIP_BASE =
  "relative inline-flex h-[30px] cursor-pointer select-none items-center whitespace-nowrap rounded-[10px] text-[13px] [corner-shape:superellipse(1.6)] [text-shadow:none] transition-[background-color,color,scale] duration-150 ease-out after:absolute after:-inset-x-1 after:-inset-y-[5px] active:not-disabled:scale-[0.96]"

export const chipClass = `${glassClass} ${CHIP_BASE} gap-[7px] pr-3 pl-2.5 font-medium text-(--ink-2) hover:bg-white/[0.14] hover:text-unison-text`

export const raisedChipClass = `${CHIP_BASE} gap-[7px] bg-[linear-gradient(180deg,#fff,#e8e8ee)] pr-3 pl-2.5 font-bold text-[#121116] shadow-[inset_0_1px_0_#fff,inset_0_-1px_0_rgba(18,17,22,0.14),0_1px_2px_rgba(0,0,0,0.25)]`

export const chipIconClass = "size-[15px] shrink-0"

export const tagClass =
  "inline-flex items-center gap-1 rounded bg-unison-bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-unison-text-secondary"

export const popoverSurfaceClass =
  "bg-[rgba(15,14,19,0.42)] text-unison-text shadow-[inset_0_1px_0_rgba(255,255,255,0.1),inset_0_0_0_1px_rgba(255,255,255,0.06),0_16px_48px_rgba(0,0,0,0.35)] backdrop-blur-[24px] backdrop-saturate-[1.8]"

export const tooltipSurfaceClass = `${popoverSurfaceClass} rounded-[10px] px-2.5 py-1.5 text-[11px] font-medium leading-snug`

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium transition-[color,background-color,box-shadow,opacity,scale] duration-150 ease-[cubic-bezier(0.2,0,0,1)] active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100"

const BUTTON_VARIANTS = {
  primary: "bg-unison-text font-semibold text-unison-bg hover:opacity-90",
  fill: "bg-white/[0.08] text-unison-text hover:bg-white/[0.12]",
  ghost: "text-unison-text-secondary hover:bg-unison-bg-hover hover:text-unison-text",
  danger: "bg-red-500/10 text-[#fca5a5] hover:bg-red-500/20",
}

const BUTTON_SIZES = {
  md: "px-3.5 py-2 text-sm has-[>svg:first-child]:pl-3",
  sm: "px-2.5 py-1.5 text-[13px] has-[>svg:first-child]:gap-[7px] has-[>svg:first-child]:pl-2",
}

export type ButtonVariant = keyof typeof BUTTON_VARIANTS

export function buttonClass(variant: ButtonVariant, size: keyof typeof BUTTON_SIZES = "md"): string {
  return `${BUTTON_BASE} ${BUTTON_VARIANTS[variant]} ${BUTTON_SIZES[size]}`
}
