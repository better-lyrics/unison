import { describe, expect, it } from "vitest"
import { NOTIFICATION_KINDS } from "../../../src/notifications/kinds"
import { NOTIFICATION_WORDS } from "./notification-words"

describe("notification words", () => {
  it("cover exactly the server's notification kinds", () => {
    expect(Object.keys(NOTIFICATION_WORDS).sort()).toEqual(Object.keys(NOTIFICATION_KINDS).sort())
  })
})
