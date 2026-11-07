const token = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim()

export const tokenMs = (name: string, fallback: number) => {
  const value = token(name)
  const amount = Number.parseFloat(value)
  if (Number.isNaN(amount)) return fallback
  return value.endsWith("ms") ? amount : amount * 1000
}

export const tokenValue = (name: string, fallback: string) => token(name) || fallback
