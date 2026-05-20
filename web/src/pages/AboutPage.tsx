export function AboutPage() {
  return (
    <div className="max-w-2xl space-y-10">
      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">What Unison is</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Unison is a public lyrics database for synced lyrics on YouTube Music. No label deal, no licensing arrangement,
          no proprietary scraper. Every line in here was submitted by someone in the community.{" "}
          <a
            href="https://better-lyrics.boidu.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text underline underline-offset-2 hover:no-underline"
          >
            Better Lyrics
          </a>
          , the browser extension that overlays synced lyrics on YT Music, reads from this database. Submitting and
          voting is what keeps it alive.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">How the leaderboards work</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Two song boards. <span className="font-medium text-unison-text">Most Wanted</span> covers songs with no synced
          lyrics yet, ranked by reputation-weighted demand. <span className="font-medium text-unison-text">Needs Fixing</span>{" "}
          is the opposite problem: songs that already have synced lyrics, but enough people flagged the timing that it's
          worth a second pass.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          The <span className="font-medium text-unison-text">Curators</span> board ranks contributors by the quality and
          quantity of their submissions. Display names like "BrightVivaceRoll" are derived deterministically from each
          contributor's public key. No usernames, no accounts to remember.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">How to contribute</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Install Better Lyrics. The extension handles the keypair, the signing, and the submission UI. With a YT Music
          song page open, you can submit lyrics in TTML or LRC format. Voting nudges accurate submissions up and
          inaccurate ones down. Sync-problem reports feed the Needs Fixing board.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Sign-in for this website (so you can see your own rank highlighted and claim a handle later) is on the way.
          The server side is live; the extension half ships when Better Lyrics does its next release.
        </p>
      </section>
    </div>
  )
}
