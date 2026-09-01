// The user-facing short id: last 6 hex chars of a 64-hex key id.
export const shortKeyId = (keyId: string): string => keyId.slice(-6)
