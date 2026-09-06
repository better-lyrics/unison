// A curator's shareable handle, derived from the display name: lowercase, only letters, digits,
// and underscore (the same alphabet the nickname editor enforces). Used for the /u/<handle> URL.
export function toHandle(displayName: string): string {
  return displayName.toLowerCase().replace(/[^a-z0-9_]/g, "")
}
