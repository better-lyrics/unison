# Unison

[![Unison](https://github.com/user-attachments/assets/c7617317-f4cf-44e6-8b2d-096fd6a42318)](https://unison.betterlyrics.org)

Crowdsourced lyrics API for [Better Lyrics](https://github.com/better-lyrics/better-lyrics). People submit synced lyrics and vote on each other's versions, and the API serves the top-ranked one for a song.

[Website](https://unison.betterlyrics.org) · [API guide](https://docs.betterlyrics.org/unison) · [Discord](https://discord.gg/UsHE3d5fWF)

> [!IMPORTANT]
> Showing Unison lyrics in an app? You must credit Unison and the submitter. See [Attribution](#attribution); apps have until 7 February 2027.
>
> Unison is for people, non-profits and open-source projects only. Companies cannot use it. See [Who can use Unison](#who-can-use-unison).

## Quick start

Reading needs no key or signature.

```bash
curl "https://unison.betterlyrics.org/lyrics?v=Ugr4KKK_SqY"
```

```json
{
  "success": true,
  "data": {
    "id": 13529,
    "videoId": "Ugr4KKK_SqY",
    "song": "Explorer",
    "artist": "Justice, Connan Mockasin",
    "album": "Hyperdrama",
    "isrc": "FR8EU2300090",
    "lyrics": "<tt xmlns=\"http://www.w3.org/ns/ttml\" ...",
    "format": "ttml",
    "syncType": "richsync",
    "confidence": "low"
  }
}
```

## Who can use Unison

You can use the Unison API and the database dump if you are:

- a person, for yourself or for a project you do not sell
- a non-profit, school, library or public body
- an open-source project, even one with a paid tier, as long as the app's full source code is public under an OSI-approved license and Unison lyrics are free to every user of the app

Companies and other businesses cannot use Unison, even if their product is free. This applies from 13 November 2026.

Dumps published before 13 November 2026 stay under ODbL 1.0.

The full terms are in the [Unison Community License](LICENSE-DATA.md).

## Attribution

Any app that shows Unison lyrics must credit Unison and the person who submitted them. The credit can sit at the end of the lyrics; it does not have to stay on screen. Apps integrating Unison have until **7 February 2027** to add it.

### If you use the API

Show `Lyrics from Unison`, linked to `https://unison.betterlyrics.org/song/<videoId>`, and the submitter's `submitter.displayName`, linked to `https://unison.betterlyrics.org/curator/<submitter.keyId>`. Every lyric response carries both.

After the deadline, apps that don't show the credit may lose access to the API.

### If you use the database dump

The [dump](#database-dump) license requires the Unison credit. The submitter credit is our request rather than a license term. A lyric's `submitter_key_id`, when set, matches a row in `contributors`, which has the submitter's `display_name` and `profile_url`. The lyric's `url` column links to its page on Unison.

### Good examples

- Under the last line: **Lyrics from Unison · submitted by boidu**, with both parts linked.
- In an always visible spot next to the lyrics, or in a footer or credits row that opens with them.

### Bad examples

- No credit at all.
- "Unison" with no link.
- Unison credited, but the submitter left out.
- The credit only on an About or settings page.
- Unison lyrics labelled as another provider's.

### Why?

Every lyric on Unison was submitted by someone in the community, for free. Seeing their name next to their work is how they get thanked, and it helps bring in the next contributor. The link matters as much as the name: a listener who spots a wrong line follows it to the song page to vote, report or submit a fix, so the lyrics in your app get better over time.

## Endpoints

| Method | Path | What it does | Signed |
| --- | --- | --- | --- |
| `GET` | `/lyrics` | Top-ranked lyric for a video id, ISRC, Spotify / Apple Music / Tidal track id, or song and artist | No |
| `GET` | `/lyrics/search` | Every match for a query, best first | No |
| `GET` | `/lyrics/:id` | One lyric by id | No |
| `POST` | `/lyrics/submit` | Submit lyrics | Yes |
| `POST` / `DELETE` | `/lyrics/:id/vote` | Upvote, downvote or remove your vote | Yes |
| `POST` | `/lyrics/:id/report` | Report a lyric | Yes |

Lookup examples:

```
GET /lyrics?v=Ugr4KKK_SqY
GET /lyrics?isrc=FR8EU2300090
GET /lyrics?song=Explorer&artist=Justice
GET /lyrics/search?q=explorer+justice
```

Every response is `{ "success": true, "data": ... }`, or `{ "success": false, "error": ..., "code": ... }` with an HTTP error status. The full rules for each endpoint are in the [Reference](#reference).

## Caching

Keep the lyrics you fetch and check them before you download them again. A check is cheaper than a full download for both Unison and your app, and your copy stays in sync with edits and new versions.

Every `GET /lyrics` lookup sends an `ETag`. Save it with the lyric and send it back as `If-None-Match`. If the lyric is the same, Unison answers `304 Not Modified` with no body, and you use the copy you have:

```bash
curl -i "https://unison.betterlyrics.org/lyrics?v=Ugr4KKK_SqY" \
  -H 'If-None-Match: <the ETag you saved>'
```

The tag changes when someone edits the lyric or its song details, when the submitter changes their name, or when another version moves to the top. Votes, confidence and the submitter's stats can change under the same tag, so a saved copy may show old numbers.

## Signed requests

All write operations require signed requests using ECDSA P-256:

```json
{
  "payload": {
    "keyId": "<sha256-hash-of-public-key>",
    "timestamp": 1703520000000,
    "nonce": "<random-16+-char-string>",
    ...request data
  },
  "signature": "<base64-ecdsa-signature>",
  "publicKey": { "kty": "EC", "crv": "P-256", ... }
}
```

- `keyId`: SHA-256 hash of the public key (hex)
- `timestamp`: Must be within ±5 minutes of server time
- `nonce`: Unique per request (replay prevention)
- `signature`: ECDSA signature over the canonical JSON payload
- `publicKey`: Required on first request to register the key

## Database dump

There's a daily snapshot of the public lyrics corpus at
`https://unison-dumps.boidu.dev/dumps/latest.dump`. Sha256, row counts, and
the rest of the metadata are at `dumps/manifest.json` on the same host.

It's a `pg_dump -Fc` against Postgres 18, scoped to a `public_dump` schema
with `lyrics`, `contributors`, `requested_songs`, and `lyrics_requests`. It
leaves out accounts, requester ids, individual votes and reports. Each lyric
keeps its score, vote totals, submitter key id and Unison link. `contributors`
has each submitter's display name and profile link.

To restore a copy:

```bash
# 1. Download and verify
curl -O https://unison-dumps.boidu.dev/dumps/latest.dump
curl -O https://unison-dumps.boidu.dev/dumps/latest.dump.sha256
sha256sum -c latest.dump.sha256

# 2. Create a fresh database
createdb unison_mirror

# 3. Restore
pg_restore -d unison_mirror --no-owner --no-privileges latest.dump
```

The `lyrics` column is stored gzip-compressed, same as in the live DB. Full-text
search is omitted from the dump. If you need search on a mirror, decompress the
column and run the project's `backfill-text-search` job against your restored
DB (see `src/jobs/backfill-text-search.ts`).

The dump has its own license, separate from the code. See [License](#license).

## Running locally

```
pnpm install
pnpm run dev        # local server
pnpm run test       # tests
pnpm run typecheck  # types
pnpm run check      # lint and format
```

Environment variables are listed under [Configuration](#configuration).

## Reference

### Looking up lyrics

`GET /lyrics` needs one way to name the song:

| Parameter | Example | Notes |
| --- | --- | --- |
| `v` | `Ugr4KKK_SqY` | YouTube video id. |
| `isrc` | `FR8EU2300090` | Any case, hyphens optional. |
| `song` + `artist` | `Explorer`, `Justice` | `artist` matches any one credited name. Add `album` or `duration` (seconds, ±2 s) to narrow it. |
| `spotify`, `apple_music`, `tidal` | track id | A track id, not a link. Resolved to an ISRC through [BiniLink](https://link.binimum.org). If several are sent, the first that resolves wins, in that order. |

Use `v` when you can: it's the fastest lookup. Without `v`, Unison falls back to `isrc`, then Spotify / Apple Music / Tidal id, then `song` + `artist`, and returns the first match. The fallbacks can take longer to answer.

Besides the lyric, the response can carry:

- `matchedBy` on every lookup except `v`: `isrc`, `song_artist` or `linked_video`. A `linked_video` match is the YouTube video BiniLink links to the ISRC, which can be a different release, so its timing may drift.
- `variant` on `v` lookups: `primary` is the lyric every caller gets. `own` (your submission) and `explore` (an exploration pick) were chosen for you, so only `primary` results and 404s are safe to share between callers.

Errors:

- `404` when no lyric matches.
- `503 LOOKUP_PENDING` with `Retry-After` while BiniLink matches a new id, or while BiniLink is down. Retry a few times, then give up. An `isrc`-only lookup never returns it.
- `400 INVALID_ID` when every provider id is malformed and there is nothing else to look up. Next to a valid id, `isrc` or `song` + `artist`, a malformed id is ignored.

### Search ranking

The `q` parameter searches across video ID, ISRC, metadata (song/artist/album via trigram similarity), and lyrics content (full-text search). Results are ranked as: exact identifier match > strong metadata match > lyrics content match > weak metadata match. Relevance decides the order within each group; the community score only breaks ties, so a new or unvoted lyric that matches the query exactly still comes first. `song` + `artist` uses the same artist credit matching as `GET /lyrics`.

### Response fields

`format` is `ttml`, `lrc` or `plain`. `syncType` is `richsync` (word or syllable timing), `linesync` or `plain`. `confidence` says how far the community agrees on the lyric:

- `low`: fewer than 3 votes, an effective score under 0.5, or upvotes only from accounts loyal to the submitter.
- `medium`: at least 3 votes and an effective score of 0.5 or more.
- `high`: the same as `medium`, and the upvotes come from both harsh and generous raters.

### Submitting

```
POST /lyrics/submit
{
  "videoId": "Ugr4KKK_SqY",
  "song": "Explorer",
  "artist": "Justice, Connan Mockasin",
  "album": "Hyperdrama",
  "isrc": "FR8EU2300090",
  "duration": 249,
  "lyrics": "[00:15.00]First line...",
  "format": "lrc",
  "syncType": "linesync",
  "language": "en"
}
```

`album`, `isrc`, `language` and `syncType` are optional. `videoId` takes a bare id or a YouTube / YouTube Music link. A bad video id or ISRC answers `400 INVALID_PAYLOAD` with a `hint` to show the user.

### Voting

```
POST /lyrics/:id/vote
{ "vote": 1 }   // upvote
{ "vote": -1 }  // downvote

DELETE /lyrics/:id/vote  // remove vote
```

### Reporting

```
POST /lyrics/:id/report
{
  "reason": "wrong_song",
  "details": "optional"
}
```

Reasons: `wrong_song`, `bad_sync`, `offensive`, `spam`, `other`

### Sign in with Better Lyrics

The Better Lyrics extension owns the user's ECDSA keypair. To prove identity to a web client, open a long-lived port to the extension and exchange one signed challenge for one signed response.

#### Wire protocol

Open a port named `bl-auth-site` against the extension's Chrome Web Store id. Send one request, await one response.

Request:

```ts
{ type: "bl-auth-request", nonce: string, origin: string }
```

`nonce` is issued by your backend per challenge. `origin` must equal `window.location.origin`.

Success:

```ts
{
  ok: true,
  signedBody: {
    payload: { origin: string, timestamp: number, nonce: string, keyId: string },
    signature: string,    // base64
    publicKey: JsonWebKey,
  }
}
```

Failure: `{ ok: false, reason }`, with `reason` one of `ORIGIN_MISMATCH`, `INVALID_REQUEST`, `USER_CANCELLED`, `USER_DISMISSED`, `SIGN_FAILED`.

#### Client

```ts
const BL_EXTENSION_ID = "effdbpeggelllpfkjppbokhmmiinhlmg"

async function signInWithBetterLyrics(): Promise<SignedBody> {
  const { nonce } = await fetch("/auth/challenge").then(r => r.json())

  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port
    try {
      port = chrome.runtime.connect(BL_EXTENSION_ID, { name: "bl-auth-site" })
    } catch {
      reject(new Error("Extension not installed or origin not allowed"))
      return
    }

    let settled = false
    port.onMessage.addListener(msg => {
      if (settled) return
      settled = true
      if (msg.ok) resolve(msg.signedBody)
      else reject(new Error(msg.reason))
      try { port.disconnect() } catch {}
    })
    port.onDisconnect.addListener(() => {
      if (settled) return
      settled = true
      reject(new Error(chrome.runtime.lastError?.message ?? "Port closed"))
    })

    port.postMessage({ type: "bl-auth-request", nonce, origin: window.location.origin })
  })
}
```

Listeners must attach before `postMessage`, and the calling button should disable itself until the promise settles so a second click doesn't open a second popup.

#### Server

Verify `signedBody` with the same scheme as a per-request signature (see [Signed requests](#signed-requests)): nonce is unused, `origin` matches, `timestamp` within ±5 minutes, ECDSA P-256 over canonical-JSON `payload` against `publicKey`, `keyId === sha256(normalized publicKey)`. If all five pass, treat `keyId` as the stable user id.

#### Adding a new origin

To talk to the extension from a new origin, open a PR against [better-lyrics/better-lyrics](https://github.com/better-lyrics/better-lyrics):

1. Add the HTTPS origin to `externally_connectable.matches` in `manifest.json`.
2. Add an entry for the origin to `AUTH_PARTNER_METADATA` in `src/modules/auth/partners.ts` with a short `id` and an `iconUrl` (`null` for none).

#### Browser support

The extension connection works in Chrome and Chromium-based browsers only, because Firefox does not implement `externally_connectable` for web pages ([Bugzilla 1319168](https://bugzilla.mozilla.org/show_bug.cgi?id=1319168)). In other browsers, the website accepts an identity file instead (see the [FAQ](#i-cant-sign-in-on-the-website-what-do-i-do)).

### Configuration

- `BINILINK_LOOKUP_ENABLED=true` turns on `spotify`, `apple_music` and `tidal` lookups. Without it, those ids never find anything.
- When `BLYRICS_API_INVALIDATE_URL` and `BLYRICS_API_INVALIDATE_SECRET` are set, every lyrics cache invalidation also POSTs `{ "videoIds": [...] }` to that URL with the secret as a Bearer token, so the Better Lyrics API can drop its shared copy.
- Requests carrying `BLYRICS_API_KEY` in the `x-blyrics-api-key` header skip the per-IP read rate limit, since the Better Lyrics API relays many users from a few Cloudflare IPs.
- `DUMP_DATABASE_URL` points the dump pipeline at a restricted role (see [Dump safety](#dump-safety)). If it's unset, the pipeline uses `DATABASE_URL`.

### Dump safety

The dump pipeline only writes to the `public_dump` schema. There's no
`INSERT`, `UPDATE`, `DELETE`, or `ALTER` against `public.*` anywhere in the
code, and a test in `src/jobs/dump.test.ts` fails CI if anyone adds one.

If you want database-level enforcement on top of that, run the dump under a
restricted Postgres role:

```sql
CREATE ROLE unison_dump WITH LOGIN PASSWORD '<choose-one>';
GRANT USAGE ON SCHEMA public TO unison_dump;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO unison_dump;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO unison_dump;
GRANT CREATE ON DATABASE <db-name> TO unison_dump;
CREATE SCHEMA IF NOT EXISTS public_dump AUTHORIZATION unison_dump;
```

Set `DUMP_DATABASE_URL` to a connection string that authenticates as that
role. If it's unset, the pipeline uses `DATABASE_URL` as before.

## FAQ

### Do I need an API key?

Not to read lyrics. Submitting, voting and reporting need a [signed request](#signed-requests) from a Better Lyrics key.

### What should my app send as its User-Agent?

Your app's name and a link to it, like `MyPlayer/2.1 (https://github.com/you/myplayer)`, so we can get in touch if something goes wrong.

### Will the response format change?

New fields can show up, but existing ones are never renamed or removed.

### How do I submit or fix lyrics?

Most people do it from Better Lyrics. The "Submit lyrics with Unison" button under a song's lyrics opens a form filled in with the song's details, and the Unison card under the lyrics has upvote, downvote and report buttons. Other apps can do the same through the API, and third-party clients such as [unison.prjktla.my.id](https://unison.prjktla.my.id/) support it too.

### Can I edit my lyric?

Yes. Open the Unison page in Better Lyrics options. Only the submitter can edit a lyric. Most fixes go live at once. An edit to a sealed lyric, or one that changes a lot of the text or timing, waits for a Council member to approve it.

### Why isn't my version the one shown?

Unison shows the top-ranked version. Votes decide it, weighted by each voter's reputation, and tighter sync gets a boost. A new version needs votes before it can pass one people already like.

### Why didn't my lyric's score go up when I upvoted it?

Take a wild guess.

### Why did my lyric disappear?

Lookups hide a lyric that has been heavily downvoted or reported by the community.

### What happens when I report a lyric?

Reports from established accounts count toward hiding it. Once a lyric has enough of them, Unison hides it right away and the Council reviews it. They either remove it or put it back.

### Why does a title and artist lookup miss a song Unison has?

Titles are compared with case, accents, punctuation and anything in brackets ignored, and the artist only has to share one credited name. A title written another way, like `Song - 2011 Remaster`, still misses. Prefer a video id or ISRC when you have one.

### Why are the lyrics timed for a different version of the song?

Check `matchedBy`. A `linked_video` match means no lyric had the ISRC or matched the title and artist, so Unison used the YouTube video BiniLink links to the ISRC, which can be another release. Submitting lyrics for the song with its ISRC fixes it.

### What does the seal mean?

A Better Lyrics Council member approved the lyric. Sealed lyrics get a small ranking boost, but community votes can still overtake them.

### How do my lyrics get sealed?

Council members review lyrics that have a positive score and aren't hidden, starting with the top-ranked version of each song, and seal the ones they approve. You can't request a seal. Upvotes are what put your lyric in front of them. Lyrics by Council members can't be sealed.

### How do I earn XP?

You earn XP when something you did holds up: one of your lyrics reaches medium confidence, your vote agrees with where the community lands, or you fill someone's request. Submitting or voting alone earns nothing.

### Is there a rate limit?

Yes. Reads are limited per IP, and submissions have their own limit. Over the limit, Unison answers `429 RATE_LIMITED`.

### Should I cache lyrics?

Yes. Save each lyric with its `ETag` and check it with `If-None-Match` before you download it again. See [Caching](#caching).

### Can I use the lyrics in my own app?

Yes, if your app is a personal project, a non-profit or open source. It must also credit Unison and the submitter. See [Who can use Unison](#who-can-use-unison) and [Attribution](#attribution).

### I reinstalled Better Lyrics or lost my key. Is my account gone?

Not if you exported your identity file or linked Discord.

- With the file, open Better Lyrics options, go to Identity and use Import key.
- With Discord, join the [Better Lyrics Discord](https://discord.gg/UsHE3d5fWF) and run `/migrate`. Butler, our bot, moves your history from the old key to the new one.

### I can't sign in on the website. What do I do?

Signing in with the extension needs Chrome or a Chromium-based browser. In any other browser, export your identity file from Better Lyrics options under Identity and upload it with "Upload identity file". It is the key to your account, so only upload it on unison.betterlyrics.org.

## Thanks

Track id lookups run on [BiniLink](https://link.binimum.org) by [bini](https://binimum.org), a public API that maps Spotify, Apple Music, Tidal and YouTube tracks to ISRCs. Thanks to bini for building it.

## Funding

> [!IMPORTANT]
>
> Unison is self-funded. The API is free for Better Lyrics and every community app that reads from it, and the database, cache, and servers behind it are paid for out of pocket.
>
> Your support helps cover hosting costs and keeps the API free for everyone.

<a href="https://www.buymeacoffee.com/boidu" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="42" /></a>

[![Github Sponsors](https://img.shields.io/static/v1?label=Sponsor&message=%E2%9D%A4&logo=GitHub&color=%23F20C33)](https://github.com/sponsors/boidushya)

## License

Source code: [AGPL-3.0](LICENSE).

Data (the API and the database dump): [Unison Community License 1.0](LICENSE-DATA.md). Dumps published before 13 November 2026 stay under [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/).

Required attribution: see [Attribution](#attribution).

### Why there is no commercial license

Unison no longer offers a commercial license.

Until 13 November 2026, the database dump listed a paid license for companies. We never sold one, and we never talked pricing with anyone. Some inquiries came in, and we did not reply to any of them.

Every lyric on Unison was synced by a community member, on their own time, for free. Some lyrics companies take that kind of work, sell API access to it and keep the money. We'd rather not be one of them, so we stopped offering it.

The words belong to their songwriters and publishers. The hours spent syncing them belong to our community, and neither is ours to sell.

### Takedowns

Unison does not own any lyrics. Songwriters and publishers own them. Community members submit them, and each submitter is responsible for what they post.

If you hold the rights to a song and want its lyrics removed, email unison-takedown@boidu.dev. Include a link to the lyrics on Unison and proof that you hold the rights. We remove the lyrics once we confirm both, and we may turn down requests that leave either out.

Unison, its API and its dumps come as is, with no warranty. We are not liable for how anyone uses them.
