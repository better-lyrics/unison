// Borderless translucent panel: the standard container surface across the SPA. Structure comes
// from the fill and surrounding whitespace, not a border.
export const panelClass = "rounded-lg bg-white/[0.02]"

// Panels that hold controls or editable content also want inner padding and vertical rhythm.
export const editableCardClass = `${panelClass} space-y-3 p-4`

export const tooltipSurfaceClass =
  "rounded-md border border-unison-border-strong bg-[#0b0a0e] px-2.5 py-1.5 text-[11px] font-medium leading-snug text-unison-text shadow-[0_10px_28px_rgba(0,0,0,0.55)]"
