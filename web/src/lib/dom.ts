export function isEditableTarget(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable
}
