export function AboutPage() {
  return (
    <div className="max-w-2xl space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">What Unison is</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          A public database for synced lyrics on YouTube Music. Everything in here was submitted by someone using{" "}
          <a
            href="https://betterlyrics.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text underline underline-offset-2 hover:no-underline"
          >
            Better Lyrics
          </a>
          , the browser extension for YT Music. Better Lyrics checks a few sources when it overlays lyrics on a song;
          Unison is the community-fed one.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">How the leaderboards work</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Two song boards. Most Wanted is songs nobody's submitted lyrics for yet, ranked by reputation-weighted demand.
          One request from a long-time contributor outranks a hundred from throwaway accounts, so the top of the board
          reflects what people actually care about and not who has the most browser tabs open. Needs Fixing is the
          inverse: songs that already have synced lyrics, but enough listeners flagged the timing for it to be worth a
          second pass.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          The Curators board ranks people by submission volume and how much of that work survived voting. Names like
          "BrightVivaceRoll" come from each contributor's public key, which means no accounts and no usernames to fight
          over.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">How to contribute</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Install Better Lyrics. With a YT Music page open, the extension gives you a panel for pasting in lyrics,
          either TTML or LRC. Voting on existing submissions decides which version everyone else sees by default, and
          bad sync gets reported from the same panel. Those reports populate Needs Fixing.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Sign-in for this site is wired up on the server already. The extension half ships with the next Better Lyrics
          release.
        </p>
      </section>

      <footer className="border-t border-unison-border pt-6 text-xs text-unison-text-muted">
        <span className="text-unison-text-secondary">Built with</span>{" "}
        <a
          href="https://betterlyrics.org"
          target="_blank"
          rel="noopener noreferrer"
          className="text-unison-text underline underline-offset-2 hover:no-underline"
        >
          Better Lyrics
        </a>
        <span className="px-1.5 opacity-60">·</span>
        <a
          href="https://composer.boidu.dev"
          target="_blank"
          rel="noopener noreferrer"
          className="text-unison-text underline underline-offset-2 hover:no-underline"
        >
          Composer
        </a>
      </footer>
    </div>
  )
}
