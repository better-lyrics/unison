// One owner for the exam's buttons so styling stays consistent and never regresses to an
// invisible control. Both use defined palette tokens and read on any surface: primary is the
// high-contrast inverted fill, secondary carries a structural border (matching the app's
// bordered bg-elevated controls) so it stays visible on translucent panels.

export const examButtonPrimary =
  "inline-flex cursor-pointer items-center justify-center rounded-md bg-unison-text px-4 py-2.5 text-sm font-semibold text-unison-bg transition-[opacity,scale] hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"

export const examButtonSecondary =
  "inline-flex cursor-pointer items-center justify-center gap-2 rounded-md border border-unison-border bg-unison-bg-elevated px-4 py-2.5 text-sm font-medium text-unison-text-secondary transition-[color,background-color,border-color,scale] hover:border-unison-border-strong hover:bg-unison-bg-hover hover:text-unison-text active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50"

export const examButtonGhost =
  "inline-flex cursor-pointer items-center gap-2 rounded-md border border-unison-border bg-unison-bg-elevated px-3 py-1.5 text-xs font-medium text-unison-text-secondary transition-colors hover:border-unison-border-strong hover:bg-unison-bg-hover hover:text-unison-text"
