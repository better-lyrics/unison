# Unison

Crowdsourced lyrics API for [Better Lyrics](https://github.com/better-lyrics/better-lyrics).

Cloudflare Workers + D1 + KV with Community Notes-style reputation system.

## Authentication

All write operations require an `X-Device-ID` header:

```
X-Device-ID: <uuid-from-extension>
```

The device ID is a hybrid of UUID (from `chrome.storage.local`) and a lightweight fingerprint.

## API

### Get lyrics

```
GET /lyrics?v=<videoId>
GET /lyrics?song=<song>&artist=<artist>
GET /lyrics?song=<song>&artist=<artist>&duration=<ms>
```

Duration matching uses ±2s tolerance (configurable in `src/config.ts`).

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
  "duration": 180000,
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

## License

MIT
