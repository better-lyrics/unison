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

-- Multi-variant lyrics: allow multiple entries per video_id
-- Drop the unique constraint so multiple submissions can coexist
ALTER TABLE lyrics DROP CONSTRAINT IF EXISTS lyrics_video_id_key;

-- Drop the unique submitter constraint (users can submit multiple variants, capped in app logic)
DROP INDEX IF EXISTS idx_lyrics_video_submitter;

-- Composite index for efficient "best variant" lookups
CREATE INDEX IF NOT EXISTS idx_lyrics_video_id_ranking
    ON lyrics(video_id, effective_score DESC);
