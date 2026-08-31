# Unison

Crowdsourced lyrics API for [Better Lyrics](https://github.com/better-lyrics/better-lyrics).

## Authentication

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

## Sign in with Better Lyrics

The Better Lyrics extension owns the user's ECDSA keypair. To prove identity to a web client, open a long-lived port to the extension and exchange one signed challenge for one signed response.

### Wire protocol

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

### Client

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

### Server

Verify `signedBody` with the same scheme as a per-request signature (see [Authentication](#authentication)): nonce is unused, `origin` matches, `timestamp` within ±5 minutes, ECDSA P-256 over canonical-JSON `payload` against `publicKey`, `keyId === sha256(normalized publicKey)`. If all five pass, treat `keyId` as the stable user id.

### Adding a new origin

To talk to the extension from a new origin, open a PR against [better-lyrics/better-lyrics](https://github.com/better-lyrics/better-lyrics):

1. Add the HTTPS origin to `externally_connectable.matches` in `manifest.json`.
2. Add an `AUTH_PARTNER_METADATA` entry in `src/core/constants.ts` with an `id` and optional `iconUrl`.

### Browser support

Chrome and Chromium-based browsers only. Firefox does not implement `externally_connectable` for web pages ([Bugzilla 1319168](https://bugzilla.mozilla.org/show_bug.cgi?id=1319168)).

## API

### Get lyrics

```
GET /lyrics?v=<videoId>
GET /lyrics?song=<song>&artist=<artist>
GET /lyrics?song=<song>&artist=<artist>&album=<album>&duration=<seconds>
```

Returns the highest-scored match. Optional `album` and `duration` narrow results.
Duration matching uses ±2s tolerance (configurable in `src/config.ts`).

### Search lyrics

Returns all matching entries sorted by score (highest first).

```
GET /lyrics/search?q=<query>
GET /lyrics/search?song=<song>&artist=<artist>
GET /lyrics/search?song=<song>&artist=<artist>&album=<album>
GET /lyrics/search?song=<song>&artist=<artist>&duration=<seconds>
```

The `q` parameter searches across video ID, ISRC, metadata (song/artist/album via trigram similarity), and lyrics content (full-text search). Results are ranked in three tiers: exact identifier match > metadata similarity > lyrics content match.

### Get by ID

```
GET /lyrics/:id
```

### Translate lyrics

Translates and romanizes a block of lyric lines. Unison fetches and parses Google's `lyrics_translate` server-side and returns clean per-line results, so clients do not parse Google output and do not each hit the rate-limited endpoint. No signature required. This endpoint is gated by the `TRANSLATION_PROXY_ENABLED` env flag; when it is off the route is not mounted and any call returns the generic `404`.

```
POST /translate
{
  "lines": ["안녕하세요", "", "반갑습니다"],
  "to": "en",
  "from": "ko",
  "videoId": "dQw4w9WgXcQ"
}
```

- `lines`: lyric lines in display order. Blank lines and lone `♪` markers are allowed and preserved by position in the response.
- `to`: target language, ISO 639-1.
- `from`: source language, ISO 639-1. Optional; omit it to detect the source in-process. Do not send `"auto"`, omit the field instead.
- `videoId`: optional, stored on the cache row for provenance.

The response is a bare object, not the `{ success, data }` envelope the read endpoints use:

```json
{
  "lines": [
    { "translation": "Hello", "romanization": "annyeonghaseyo", "needsTranslation": true },
    { "translation": null, "romanization": null, "needsTranslation": false },
    { "translation": "Nice to meet you", "romanization": "bangapseumnida", "needsTranslation": true }
  ],
  "detectedLang": "ko",
  "provider": "google-lyrics-translate",
  "cached": false
}
```

- `lines` is positionally aligned with the request: same length, blanks preserved. Map `lines[i]` onto displayed line `i`.
- `translation`: translated text, or `null` for blank and no-op lines.
- `romanization`: romanized source, or `null` when the source is already Latin-script or Google returned none.
- `needsTranslation`: `false` when the line was already in the target language or is blank, `true` when it was actually translated. Gate any overlay on this flag.
- `detectedLang`: the source language used, whether it was given or detected.
- `cached`: `true` when served from Unison's cache. Results are keyed on source and target language, the exact lines, provider, and parser version.

When `from` (given or detected) equals `to` there is nothing to translate, so every line returns `{ "translation": null, "romanization": null, "needsTranslation": false }` with a `200`. Errors are `{ "success": false, "error": "..." }`: `400` when no line is translatable or the source language cannot be detected, `502` when the upstream fails, and `503` when the outbound throttle is rate limited.

### Submit lyrics

Accepts TTML, LRC, or plain text via the `format` field.

```
POST /lyrics/submit
{
  "videoId": "dQw4w9WgXcQ",
  "song": "Song Title",
  "artist": "Artist Name",
  "duration": 180,
  "lyrics": "[00:15.00]First line...",
  "format": "lrc",
  "album": "Album Name",
  "language": "en",
  "syncType": "linesync"
}
```

Formats: `ttml`, `lrc`, `plain`
Sync Types: `richsync`, `linesync`, `plain`

### Vote

```
POST /lyrics/:id/vote
{ "vote": 1 }   // upvote
{ "vote": -1 }  // downvote

DELETE /lyrics/:id/vote  // remove vote
```

### Report

```
POST /lyrics/:id/report
{
  "reason": "wrong_song",
  "details": "optional"
}
```

Reasons: `wrong_song`, `bad_sync`, `offensive`, `spam`, `other`

## Response format

```json
{
  "success": true,
  "data": {
    "id": 123,
    "videoId": "dQw4w9WgXcQ",
    "song": "Never Gonna Give You Up",
    "artist": "Rick Astley",
    "lyrics": "...",
    "format": "lrc",
    "language": "en",
    "syncType": "linesync",
    "score": 5,
    "effectiveScore": 4.2,
    "voteCount": 12,
    "confidence": "high"
  }
}
```

### Confidence levels

- `low`: Fewer than 5 votes
- `medium`: 5+ votes from similar users
- `high`: 5+ votes with diversity bonus (both harsh and generous raters agree)

## Development

```
pnpm install
pnpm run dev      # local server
pnpm run test     # tests
pnpm run check    # lint
```

## Database dump

There's a daily snapshot of the public lyrics corpus at
`https://unison-dumps.boidu.dev/dumps/latest.dump`. Sha256, row counts, and
the rest of the metadata are at `dumps/manifest.json` on the same host.

It's a `pg_dump -Fc` against Postgres 18, scoped to a `public_dump` schema
with `lyrics`, `requested_songs`, and `lyrics_requests`. No user IDs, no
votes, no reports, no auth.

### Restore

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

### Production-DB safety

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

## License

Source code: [AGPL-3.0](LICENSE).

The dump itself is dual-licensed.

- Open: [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution
  and share-alike on derivative databases. If you're building a FOSS player
  that displays the lyrics, you only need to attribute (the "Produced Works"
  clause).
- Commercial: anyone selling a product on top of the corpus (streaming
  services, labels, distributors) needs a commercial license. Email
  `enterprise@boidu.dev` with "Unison" in the subject.

Required attribution: `Lyrics from Unison (https://unison.boidu.dev)`.
