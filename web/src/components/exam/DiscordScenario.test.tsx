import type { ScenarioSurface } from "@/lib/examApi"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { DiscordScenario } from "./DiscordScenario"

afterEach(cleanup)

const queue: ScenarioSurface = {
  id: "queue",
  kind: "channel",
  title: "review-queue",
  subtitle: "Council channel",
  messages: [
    {
      author: "Butler",
      avatar: "/pfp/butler.svg",
      bot: true,
      timestamp: "Today at 2:02 AM",
      embed: {
        title: "Sample embed",
        description: "Sample description",
        fields: [
          { name: "Track", value: "Sample Track" },
          { name: "By", value: "sample_user" },
        ],
        preview: [{ text: "Sample line one", dim: true }, { text: "Sample line two" }],
        footer: "Sample footer.",
      },
    },
  ],
}

const council: ScenarioSurface = {
  id: "council",
  kind: "channel",
  title: "council",
  subtitle: "Public",
  messages: [
    { author: "sample_user", avatar: "/pfp/kaneki.webp", text: "@you sample mention" },
    { author: "other_user", avatar: "/pfp/frog.webp", text: "sample bystander reply" },
  ],
  composer: {
    label: "Choose your reply. This one's public.",
    choices: [
      { id: "hold", label: "Reply option one" },
      { id: "cave", label: "Reply option two" },
      { id: "rude", label: "Reply option three" },
    ],
  },
}

const dm: ScenarioSurface = {
  id: "dm",
  kind: "dm",
  title: "sample_user",
  subtitle: "Direct message",
  messages: [
    { author: "sample_user", avatar: "/pfp/kaneki.webp", text: "sample dm text" },
    { author: "you", avatar: "/pfp/tiecat.webp", self: true, text: "sample self reply" },
  ],
}

const queueAction: ScenarioSurface = {
  id: "queue",
  kind: "channel",
  title: "review-queue",
  subtitle: "Council channel",
  messages: [{ author: "Butler", avatar: "/pfp/butler.svg", bot: true, embed: { title: "Sample embed" } }],
  composer: {
    style: "action",
    choices: [
      { id: "seal", label: "Seal", intent: "success" },
      { id: "reject", label: "Reject", intent: "danger" },
    ],
  },
}

const dmBeat: ScenarioSurface = {
  id: "dm",
  kind: "dm",
  title: "sample_user",
  subtitle: "Direct message",
  messages: [{ author: "sample_user", avatar: "/pfp/kaneki.webp", text: "sample dm text" }],
  composer: {
    label: "Choose your reply.",
    choices: [
      { id: "hold", label: "sample self reply" },
      { id: "cave", label: "ok fine" },
    ],
  },
}

describe("DiscordScenario", () => {
  it("renders channel and dm headers with the right glyph", () => {
    const { container } = render(<DiscordScenario surfaces={[queue, dm]} answer={{}} onChange={() => {}} />)
    expect(screen.getByText("review-queue")).toBeTruthy()
    expect(screen.getByText("sample_user", { selector: ".ds-title" })).toBeTruthy()
    expect(container.querySelector(".ds-hash")).toBeTruthy()
    expect(container.querySelector(".ds-at")).toBeTruthy()
  })

  it("renders a bot message with a Bot tag and its embed", () => {
    render(<DiscordScenario surfaces={[queue]} answer={{}} onChange={() => {}} />)
    expect(screen.getByText("Butler")).toBeTruthy()
    expect(screen.getByText("Bot")).toBeTruthy()
    expect(screen.getByText("Sample embed")).toBeTruthy()
    expect(screen.getByText("Sample Track")).toBeTruthy()
    expect(screen.getByText("sample_user")).toBeTruthy()
    expect(screen.getByText("Sample footer.")).toBeTruthy()
    expect(screen.getByText("Sample line two")).toBeTruthy()
  })

  it("highlights an @mention inside message text", () => {
    const { container } = render(<DiscordScenario surfaces={[council]} answer={{}} onChange={() => {}} />)
    const mention = container.querySelector(".ds-mention")
    expect(mention?.textContent).toBe("@you")
  })

  it("gives the you-message the role colour", () => {
    const { container } = render(<DiscordScenario surfaces={[dm]} answer={{}} onChange={() => {}} />)
    expect(container.querySelector(".ds-name.ds-role")?.textContent).toBe("you")
  })

  it("reports a picked reply with the surface id and choice id", () => {
    const onChange = vi.fn()
    render(<DiscordScenario surfaces={[council]} answer={{}} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText("Reply option two"))
    expect(onChange).toHaveBeenCalledWith("council", "cave")
  })

  it("marks the saved reply as selected", () => {
    const { container } = render(
      <DiscordScenario surfaces={[council]} answer={{ council: "hold" }} onChange={() => {}} />,
    )
    const selected = container.querySelectorAll(".ds-reply.ds-sel")
    expect(selected.length).toBe(1)
    expect(selected[0].textContent).toContain("Reply option one")
  })

  describe("candidate handle and emoji", () => {
    const mentionSurface = (text: string): ScenarioSurface => ({
      id: "s",
      kind: "channel",
      title: "council",
      messages: [{ author: "sample_user", avatar: "/pfp/kaneki.webp", text }],
    })

    it("interpolates the candidate handle into a {{candidate}} mention", () => {
      const { container } = render(
        <DiscordScenario
          surfaces={[mentionSurface("{{candidate}} mine's right there")]}
          answer={{}}
          onChange={() => {}}
          candidateName="Cool Dude"
        />,
      )
      const mention = container.querySelector(".ds-mention")
      expect(mention?.textContent).toBe("@Cool Dude")
    })

    it("falls back to @you when no candidate handle is given", () => {
      const { container } = render(
        <DiscordScenario surfaces={[mentionSurface("{{candidate}} hi")]} answer={{}} onChange={() => {}} />,
      )
      expect(container.querySelector(".ds-mention")?.textContent).toBe("@you")
    })

    it("renders a known :emoji: shortcode as a local image", () => {
      const { container } = render(
        <DiscordScenario
          surfaces={[mentionSurface("looks fire :thumbsupcat:")]}
          answer={{}}
          onChange={() => {}}
        />,
      )
      const img = container.querySelector("img.ds-emoji") as HTMLImageElement | null
      expect(img?.getAttribute("src")).toBe("/emoji/thumbsupcat.png")
      expect(screen.getByText("looks fire", { exact: false })).toBeTruthy()
    })

    it("leaves an unknown :shortcode: as literal text", () => {
      const { container } = render(
        <DiscordScenario surfaces={[mentionSurface("nice :wat: one")]} answer={{}} onChange={() => {}} />,
      )
      expect(container.querySelector("img.ds-emoji")).toBeNull()
      expect(screen.getByText(":wat:", { exact: false })).toBeTruthy()
    })

    it("renders a <@Role> mention in the role's colour", () => {
      const { container } = render(
        <DiscordScenario surfaces={[mentionSurface("hey <@Moderator> look")]} answer={{}} onChange={() => {}} />,
      )
      const mention = [...container.querySelectorAll(".ds-mention")].find((n) => n.textContent === "@Moderator")
      expect(mention).toBeTruthy()
      expect((mention as HTMLElement).style.color).toBe("#e2c648")
    })

    it("renders a role mention inside a reply choice label", () => {
      const surface: ScenarioSurface = {
        id: "s",
        kind: "channel",
        title: "council",
        messages: [{ author: "u", avatar: "/pfp/ape.webp", text: "hi" }],
        composer: { label: "Reply", choices: [{ id: "esc", label: "get <@Moderator> in here" }] },
      }
      const { container } = render(<DiscordScenario surfaces={[surface]} answer={{}} onChange={() => {}} />)
      const mention = [...container.querySelectorAll(".ds-mention")].find((n) => n.textContent === "@Moderator")
      expect(mention).toBeTruthy()
    })
  })

  describe("edge cases", () => {
    it("renders a context surface with no composer and no radios", () => {
      const { container } = render(<DiscordScenario surfaces={[queue]} answer={{}} onChange={() => {}} />)
      expect(container.querySelector(".ds-composer")).toBeNull()
      expect(container.querySelectorAll("input[type=radio]").length).toBe(0)
    })

    it("renders an empty scenario without crashing", () => {
      const { container } = render(<DiscordScenario surfaces={[]} answer={{}} onChange={() => {}} />)
      expect(container.querySelector(".ds-root")).toBeTruthy()
      expect(container.querySelector(".ds-client")).toBeNull()
    })

    it("renders a message with neither text nor embed", () => {
      const bare: ScenarioSurface = {
        id: "bare",
        kind: "channel",
        title: "quiet",
        messages: [{ author: "ghost", avatar: "/pfp/ape.webp" }],
      }
      render(<DiscordScenario surfaces={[bare]} answer={{}} onChange={() => {}} />)
      expect(screen.getByText("ghost")).toBeTruthy()
    })

    it("plain text with no mention stays a single run", () => {
      const { container } = render(<DiscordScenario surfaces={[dm]} answer={{}} onChange={() => {}} />)
      expect(container.querySelector(".ds-mention")).toBeNull()
    })
  })

  describe("action composer (Seal / Reject)", () => {
    it("renders buttons coloured by intent and reports the pick with the surface id", () => {
      const onChange = vi.fn()
      const { container } = render(<DiscordScenario surfaces={[queueAction]} answer={{}} onChange={onChange} />)
      expect(container.querySelector(".ds-action-success")).toBeTruthy()
      expect(container.querySelector(".ds-action-danger")).toBeTruthy()
      fireEvent.click(screen.getByLabelText("Reject"))
      expect(onChange).toHaveBeenCalledWith("queue", "reject")
    })

    it("marks the chosen action and dims the other", () => {
      const { container } = render(
        <DiscordScenario surfaces={[queueAction]} answer={{ queue: "seal" }} onChange={() => {}} />,
      )
      expect(container.querySelector(".ds-action-success")?.classList.contains("ds-sel")).toBe(true)
      expect(container.querySelector(".ds-action-danger")?.classList.contains("ds-dim")).toBe(true)
    })
  })

  describe("progressive disclosure", () => {
    const beats = [queueAction, dmBeat, council]

    it("shows only the first unanswered scored beat", () => {
      const { container } = render(<DiscordScenario surfaces={beats} answer={{}} onChange={() => {}} />)
      expect(container.querySelectorAll(".ds-client").length).toBe(1)
      expect(screen.getByText("review-queue")).toBeTruthy()
    })

    it("reveals the next beat once the current one is answered", () => {
      const { container, rerender } = render(
        <DiscordScenario surfaces={beats} answer={{ queue: "reject" }} onChange={() => {}} />,
      )
      expect(container.querySelectorAll(".ds-client").length).toBe(2)
      rerender(<DiscordScenario surfaces={beats} answer={{ queue: "reject", dm: "hold" }} onChange={() => {}} />)
      expect(container.querySelectorAll(".ds-client").length).toBe(3)
      expect(screen.getByText("council")).toBeTruthy()
    })
  })

  describe("one-shot (capstone)", () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it("shows the finality warning and renders hold buttons, not radios", () => {
      const { container } = render(
        <DiscordScenario surfaces={[queueAction]} answer={{}} onChange={() => {}} oneShot />,
      )
      expect(screen.getByText(/whatever option you pick is final/i)).toBeTruthy()
      expect(container.querySelectorAll("button.ds-hold").length).toBe(2)
      expect(container.querySelector("input[type=radio]")).toBeNull()
    })

    it("commits a choice only after the hold completes, with the surface id", () => {
      const onChange = vi.fn()
      render(<DiscordScenario surfaces={[queueAction]} answer={{}} onChange={onChange} oneShot />)
      const seal = screen.getByText("Seal").closest("button") as HTMLButtonElement
      fireEvent.pointerDown(seal)
      vi.advanceTimersByTime(699)
      expect(onChange).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1)
      expect(onChange).toHaveBeenCalledWith("queue", "seal")
    })

    it("locks an answered beat and reveals the next while the story continues", () => {
      const { container } = render(
        <DiscordScenario surfaces={[queueAction, dmBeat]} answer={{ queue: "reject" }} onChange={() => {}} oneShot />,
      )
      expect(container.querySelectorAll(".ds-hold-locked").length).toBeGreaterThan(0)
      expect(container.querySelectorAll(".ds-client").length).toBe(2)
    })

    it("stops revealing further beats once terminated", () => {
      const { container } = render(
        <DiscordScenario
          surfaces={[queueAction, dmBeat]}
          answer={{ queue: "seal" }}
          onChange={() => {}}
          oneShot
          terminated
        />,
      )
      expect(container.querySelectorAll(".ds-client").length).toBe(1)
    })
  })

  describe("invariants", () => {
    it("scopes only one radio group per composer surface", () => {
      const onChange = vi.fn()
      render(<DiscordScenario surfaces={[queue, council]} answer={{}} onChange={onChange} />)
      const radios = screen.getAllByRole("radio")
      expect(radios.length).toBe(3)
      for (const radio of radios) expect(radio.getAttribute("name")).toBe("council")
    })
  })
})
