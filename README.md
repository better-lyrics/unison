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

The Better Lyrics browser extension owns the user's ECDSA P-256 keypair (the one whose `keyId` appears in API requests). To get that identity into a web client, the extension exposes a consent flow over a long-lived `chrome.runtime.Port`. The user clicks Approve in a popup the extension owns; the extension signs the challenge with the private key and posts the signed body back to the page.

Once you have the signed body, treat `keyId` as the user identifier. For subsequent API write requests, the same keypair signs each request body.

### Wire protocol

Open a port named `bl-auth-site` to the extension. Send one message, wait for one response.

Request:

```ts
{
  type: "bl-auth-request",
  nonce: string,  // 16+ chars; your backend issues and remembers it
  origin: string, // must equal window.location.origin
}
```

Success response:

```ts
{
  ok: true,
  signedBody: {
    payload: {
      origin: string,     // echoes your origin
      timestamp: number,
      nonce: string,      // echoes your nonce
      keyId: string,
    },
    signature: string,    // base64
    publicKey: JsonWebKey,
  }
}
```

Error responses share `{ ok: false, reason }` with `reason` being one of `ORIGIN_MISMATCH`, `INVALID_REQUEST`, `USER_CANCELLED`, `USER_DISMISSED`, `SIGN_FAILED`.

The signature covers the canonical JSON of `payload` (sorted keys, no whitespace). Same canonicalization as the API request signing scheme above.

### Client integration

```ts
const BL_EXTENSION_ID = "<chrome web store id>";

async function signInWithBetterLyrics(): Promise<SignedBody> {
  if (typeof chrome === "undefined" || !chrome.runtime?.connect) {
    throw new Error("Better Lyrics extension not detected");
  }

  const { nonce } = await fetch("/auth/challenge").then(r => r.json());

  return new Promise((resolve, reject) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect(BL_EXTENSION_ID, { name: "bl-auth-site" });
    } catch {
      reject(new Error("Extension not installed or origin not allowed"));
      return;
    }

    let settled = false;

    port.onMessage.addListener(msg => {
      if (settled) return;
      settled = true;
      if (msg.ok) resolve(msg.signedBody);
      else reject(new Error(`Sign-in failed: ${msg.reason}`));
      try { port.disconnect(); } catch {}
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      reject(new Error(chrome.runtime.lastError?.message ?? "Port closed"));
    });

    port.postMessage({
      type: "bl-auth-request",
      nonce,
      origin: window.location.origin,
    });
  });
}
```

Listeners must attach before `postMessage`. The button that triggers this should disable itself until the promise resolves, since the consent UI takes a few seconds and a second click opens a second popup.

### Server verification

Verify the `signedBody` the same way per-request signatures are verified (see [Authentication](#authentication)):

- `payload.nonce` matches one your backend issued and hasn't been used yet.
- `payload.origin` matches the request origin.
- `payload.timestamp` is within ±5 minutes of now.
- ECDSA P-256 signature verifies against `publicKey` over the canonical JSON of `payload`.
- SHA-256 of the normalized public key (only `crv`, `kty`, `x`, `y` fields, canonical JSON) matches `payload.keyId`.

If all five pass, use `keyId` as the stable user identifier. Issue your session token or whatever your auth model expects.

### Adding a new origin

To talk to the extension from a new origin, open a PR against [better-lyrics/better-lyrics](https://github.com/better-lyrics/better-lyrics) that adds two entries:

1. The origin (HTTPS only) to `manifest.json`'s `externally_connectable.matches`.
2. An `AUTH_PARTNER_METADATA` entry in `src/core/constants.ts` with an `id` and an optional `iconUrl` for the consent popup's partner favicon.

`unison.boidu.dev` and `blrcunison.vercel.app` are already on the allowlist.

### Graceful degradation

The synchronous `chrome.runtime.connect` call throws if the extension isn't installed or the origin isn't allowlisted. Catch it and show an "Install Better Lyrics" affordance pointing at the Chrome Web Store listing.

Firefox does not support `externally_connectable` web-page messaging ([Bugzilla 1319168](https://bugzilla.mozilla.org/show_bug.cgi?id=1319168)). The flow is Chrome-only until that ships. Detect Firefox and offer a fallback or hide the sign-in button accordingly.

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
