// Borderless translucent panel: the standard container surface across the SPA. Structure comes
// from the fill and surrounding whitespace, not a border.
export const panelClass = "rounded-lg bg-white/[0.02]"

// Panels that hold controls or editable content also want inner padding and vertical rhythm.
export const editableCardClass = `${panelClass} space-y-3 p-4`
