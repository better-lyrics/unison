import { Link } from "react-router-dom"

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
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
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
          The Leaderboard ranks people by submission volume and how much of that work survived voting. Names like
          "BrightVivaceRoll" come from each contributor's public key, which means no accounts and no usernames to fight
          over.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">How to contribute</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Install Better Lyrics. With a YT Music song open, the player footer has the buttons you need. Click "Request
          lyrics" to push a song onto Most Wanted, or report bad sync on a song that already has lyrics to feed it into
          Needs Fixing. To submit lyrics yourself, click "Submit lyrics with Unison" at the bottom of the page; if you
          don't have a synced version handy,{" "}
          <a
            href="https://composer.boidu.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
          >
            Composer
          </a>{" "}
          lets you sync lyrics yourself. Voting on existing submissions is what decides which version Better Lyrics
          shows everyone else by default.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          You don't need to sign in to use any of this. If you do, your row on the Leaderboard gets marked when you're
          ranked, and there's a /me page with your stats. It reuses the chunk of your identity Better Lyrics already
          keeps for you, so there's nothing extra to set up.
        </p>
      </section>

      <section className="rounded-2xl border border-unison-border/50 bg-unison-bg-elevated/50 px-3.5 py-2.5 text-sm leading-relaxed text-pretty text-unison-text-secondary">
        Heads up: signing in with Better Lyrics doesn't work in Firefox yet. You'll need a Chromium browser like Chrome
        or Edge for now.
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-unison-text">Linking Discord</h2>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          Signed-in users can connect a Discord account from the /me page. It earns you roles in our server that mirror
          where you sit on the Leaderboard, and it drops a small Discord mark next to your name across Unison so the
          linked curators are easy to spot. The same page is where you set a nickname, if going by a key-derived name
          like "BrightVivaceRoll" isn't your thing, or you can edit it from Better Lyrics under the Identity tab.
        </p>
        <p className="text-sm leading-relaxed text-unison-text-secondary">
          The server is also where we hang out and talk shop, fixing bad sync and figuring out what to build next. If
          you're contributing here, come join us at{" "}
          <a
            href="https://discord.gg/UsHE3d5fWF"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
          >
            discord.gg/UsHE3d5fWF
          </a>
          .
        </p>
      </section>

      <p className="text-sm leading-relaxed text-unison-text-secondary">
        Want the whole database? A daily snapshot is published at{" "}
        <Link to="/downloads" className="text-unison-text transition-colors hover:text-unison-text-secondary">
          /downloads
        </Link>
        .
      </p>

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-unison-border pt-6 text-xs text-unison-text-muted">
        <div>
          <span className="text-unison-text-secondary">Related projects</span>
          <span className="px-1.5 opacity-60">·</span>
          <a
            href="https://betterlyrics.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
          >
            Better Lyrics
          </a>
          <span className="px-1.5 opacity-60">·</span>
          <a
            href="https://composer.boidu.dev"
            target="_blank"
            rel="noopener noreferrer"
            className="text-unison-text transition-colors hover:text-unison-text-secondary"
          >
            Composer
          </a>
        </div>
        <a
          href="https://github.com/better-lyrics/unison"
          target="_blank"
          rel="noopener noreferrer"
          className="text-unison-text transition-colors hover:text-unison-text-secondary"
        >
          GitHub
        </a>
      </footer>
    </div>
  )
}
