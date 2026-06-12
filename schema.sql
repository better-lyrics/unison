-- Unison: Crowdsourced Lyrics Database Schema
-- Designed for PostgreSQL

-- Public keys table (cryptographic identity)
CREATE TABLE IF NOT EXISTS public_keys (
    key_id TEXT PRIMARY KEY,
    public_key TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
);

-- Users table (identity + reputation)
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    key_id TEXT UNIQUE NOT NULL,
    reputation DOUBLE PRECISION DEFAULT 1.0,
    vote_count INTEGER DEFAULT 0,
    avg_vote DOUBLE PRECISION DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
);

CREATE INDEX IF NOT EXISTS idx_users_key_id ON users(key_id);

-- User-set nickname (overrides generated petname)
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_lower TEXT
    GENERATED ALWAYS AS (LOWER(nickname)) STORED;
ALTER TABLE users ADD COLUMN IF NOT EXISTS nickname_updated_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_nickname_lower
    ON users(nickname_lower) WHERE nickname_lower IS NOT NULL;

-- Main lyrics table
CREATE TABLE IF NOT EXISTS lyrics (
    id SERIAL PRIMARY KEY,

    -- YouTube video identifier (primary lookup key)
    video_id TEXT NOT NULL,

    -- Metadata for display
    song TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    isrc TEXT,  -- International Standard Recording Code
    duration INTEGER NOT NULL,  -- in seconds

    -- Normalized values for search (lowercase, stripped)
    song_norm TEXT NOT NULL,
    artist_norm TEXT NOT NULL,

    -- Lyrics content (gzip compressed, base64 encoded)
    lyrics TEXT NOT NULL,
    format TEXT CHECK(format IN ('ttml', 'lrc', 'plain')) NOT NULL DEFAULT 'lrc',

    -- Metadata
    language TEXT,
    sync_type TEXT CHECK(sync_type IN ('richsync', 'linesync', 'plain')) NOT NULL DEFAULT 'linesync',

    -- Quality metrics (raw counts)
    score INTEGER DEFAULT 0,
    upvotes INTEGER DEFAULT 0,
    downvotes INTEGER DEFAULT 0,

    -- Reputation-weighted metrics (computed by batch job)
    effective_score DOUBLE PRECISION DEFAULT 0,
    vote_count INTEGER DEFAULT 0,
    diversity_bonus INTEGER DEFAULT 0,
    confidence TEXT CHECK(confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
    score_updated_at INTEGER,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
    updated_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),

    -- Submitter info
    submitter_id INTEGER REFERENCES users(id)
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_lyrics_video_id ON lyrics(video_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_song_artist ON lyrics(song_norm, artist_norm);

-- Votes table (for quality control)
CREATE TABLE IF NOT EXISTS votes (
    id SERIAL PRIMARY KEY,
    lyrics_id INTEGER NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote INTEGER CHECK(vote IN (-1, 1)) NOT NULL,
    is_self_vote INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),

    UNIQUE(lyrics_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_lyrics ON votes(lyrics_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);

-- Reports table (for flagging bad lyrics)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    lyrics_id INTEGER NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT CHECK(reason IN ('wrong_song', 'bad_sync', 'offensive', 'spam', 'other')) NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),

    UNIQUE(lyrics_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_lyrics ON reports(lyrics_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_effective_score ON lyrics(effective_score DESC);

-- Migrations
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS isrc TEXT;

-- Trigram search support
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS album_norm TEXT;
UPDATE lyrics SET album_norm = LOWER(TRIM(album)) WHERE album IS NOT NULL AND album_norm IS NULL;
CREATE INDEX IF NOT EXISTS idx_lyrics_song_norm_trgm ON lyrics USING GIN (song_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lyrics_artist_norm_trgm ON lyrics USING GIN (artist_norm gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_lyrics_album_norm_trgm ON lyrics USING GIN (album_norm gin_trgm_ops);

-- Full-text search on lyrics content
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS lyrics_text_search tsvector;
CREATE INDEX IF NOT EXISTS idx_lyrics_text_search ON lyrics USING GIN (lyrics_text_search);

-- Language auto-detection: tracks whether we have attempted detection
-- on this row, so the backfill job stays idempotent and the column
-- `language` keeps its semantic meaning (NULL = unknown).
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS language_detection_attempted_at TIMESTAMPTZ;
-- Detector revision the row was last evaluated against. NULL means
-- pre-versioning or never evaluated. Backfill picks up rows where
-- this is NULL or below the current DETECTOR_VERSION.
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS language_detector_version SMALLINT;
-- 'submitter' if the row's language came from the submitter, 'detector'
-- if it was auto-detected. NULL on pre-source-tracking rows (treated
-- as detector-sourced for backfill purposes). The backfill never
-- overwrites a row whose source is 'submitter'.
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS language_source TEXT;

-- Multi-variant lyrics: allow multiple entries per video_id
-- Drop the unique constraint so multiple submissions can coexist
ALTER TABLE lyrics DROP CONSTRAINT IF EXISTS lyrics_video_id_key;

-- Drop the unique submitter constraint (users can submit multiple variants, capped in app logic)
DROP INDEX IF EXISTS idx_lyrics_video_submitter;

-- Composite index for efficient "best variant" lookups
CREATE INDEX IF NOT EXISTS idx_lyrics_video_id_ranking
    ON lyrics(video_id, effective_score DESC);

-- Soft delete for submissions: preserves vote/reputation signal
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS deleted_at INTEGER;
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS deleted_by_user_id INTEGER REFERENCES users(id);
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS deleted_by_role TEXT
    CHECK (deleted_by_role IN ('submitter', 'admin'));
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'lyrics_deletion_consistency'
    ) THEN
        ALTER TABLE lyrics ADD CONSTRAINT lyrics_deletion_consistency CHECK (
            (deleted_at IS NULL AND deleted_by_user_id IS NULL AND deleted_by_role IS NULL)
            OR (deleted_at IS NOT NULL AND deleted_by_user_id IS NOT NULL AND deleted_by_role IS NOT NULL)
        );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_lyrics_active ON lyrics(id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lyrics_submitter_created
    ON lyrics(submitter_id, created_at DESC)
    WHERE deleted_at IS NULL;

-- Reputation penalty idempotency: tracks whether the auto-hide / dirty-delete
-- penalty has already been applied for this row.
ALTER TABLE lyrics ADD COLUMN IF NOT EXISTS reputation_penalized BOOLEAN DEFAULT FALSE;

-- Lyrics requests: demand signal for songs missing synced lyrics
CREATE TABLE IF NOT EXISTS requested_songs (
    video_id TEXT PRIMARY KEY,
    song TEXT NOT NULL,
    artist TEXT NOT NULL,
    thumbnail_url TEXT,
    first_requested_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),
    last_requested_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
);

CREATE TABLE IF NOT EXISTS lyrics_requests (
    id BIGSERIAL PRIMARY KEY,
    video_id TEXT NOT NULL REFERENCES requested_songs(video_id) ON DELETE CASCADE,
    requester_id TEXT NOT NULL,
    requester_type TEXT CHECK(requester_type IN ('extension', 'discord')) NOT NULL DEFAULT 'extension',
    weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    created_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER),

    UNIQUE(video_id, requester_id, requester_type)
);

CREATE INDEX IF NOT EXISTS idx_lyrics_requests_created ON lyrics_requests(created_at);

-- Request fulfillments: recognition when a synced submission fills demand
CREATE TABLE IF NOT EXISTS request_fulfillments (
    id BIGSERIAL PRIMARY KEY,
    video_id TEXT NOT NULL,
    lyrics_id INTEGER NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
    submitter_id INTEGER REFERENCES users(id),
    demand_snapshot DOUBLE PRECISION NOT NULL,
    request_count_snapshot INTEGER NOT NULL,
    fulfilled_at INTEGER NOT NULL DEFAULT (EXTRACT(EPOCH FROM NOW())::INTEGER)
);

CREATE INDEX IF NOT EXISTS idx_request_fulfillments_submitter
    ON request_fulfillments(submitter_id);
CREATE INDEX IF NOT EXISTS idx_request_fulfillments_video_fulfilled
    ON request_fulfillments(video_id, fulfilled_at DESC);
CREATE INDEX IF NOT EXISTS idx_request_fulfillments_lyrics
    ON request_fulfillments(lyrics_id);
