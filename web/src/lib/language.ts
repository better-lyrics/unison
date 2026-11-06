const names = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" })

export function languageName(code: string): string {
  try {
    return names.of(code) ?? code.toUpperCase()
  } catch {
    return code.toUpperCase()
  }
}
