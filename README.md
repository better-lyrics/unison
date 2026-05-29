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

# 4. The full-text search column is dropped from the dump for size. Rebuild it:
psql unison_mirror -c "ALTER TABLE public_dump.lyrics ADD COLUMN lyrics_text_search tsvector;"
psql unison_mirror -c "UPDATE public_dump.lyrics SET lyrics_text_search = to_tsvector('simple', lyrics);"
psql unison_mirror -c "CREATE INDEX idx_lyrics_text_search ON public_dump.lyrics USING GIN (lyrics_text_search);"
```

The `lyrics` column is stored gzip-compressed, same as in the live DB.

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
CREATE SCHEMA IF NOT EXISTS public_dump AUTHORIZATION unison_dump;
```

Set `DUMP_DATABASE_URL` to a connection string that authenticates as that
role. If it's unset, the pipeline uses `DATABASE_URL` as before.

## License

Source code: MIT.

The dump itself is dual-licensed.

- Open: [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/). Attribution
  and share-alike on derivative databases. If you're building a FOSS player
  that displays the lyrics, you only need to attribute (the "Produced Works"
  clause).
- Commercial: anyone selling a product on top of the corpus (streaming
  services, labels, distributors) needs a commercial license. Email
  `enterprise@boidu.dev` with "Unison" in the subject.

Required attribution: `Lyrics from Unison (https://unison.boidu.dev)`.
