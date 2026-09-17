export function formatKey(key: string, isMac: boolean): string {
  if (key === "Mod") return isMac ? "⌘" : "Ctrl"
  if (key === "Meta") return isMac ? "⌘" : "Meta"
  if (key === "Ctrl") return isMac ? "⌃" : "Ctrl"
  if (key === "Shift") return "⇧"
  if (key === "Alt") return isMac ? "⌥" : "Alt"
  if (key === "Space") return "Space"
  if (key === "Enter") return "↵"
  if (key === "Escape") return "Esc"
  if (key === "ArrowLeft") return "←"
  if (key === "ArrowRight") return "→"
  if (key === "ArrowUp") return "↑"
  if (key === "ArrowDown") return "↓"
  return key
}
