-- Unison: Crowdsourced Lyrics Database Schema
-- Designed for Cloudflare D1 (SQLite)

-- Users table (device identity + reputation)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_hash TEXT UNIQUE NOT NULL,
    reputation REAL DEFAULT 1.0,
    vote_count INTEGER DEFAULT 0,
    avg_vote REAL DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_users_device_hash ON users(device_hash);

-- Main lyrics table
CREATE TABLE IF NOT EXISTS lyrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    -- YouTube video identifier (primary lookup key)
    video_id TEXT NOT NULL UNIQUE,

    -- Metadata for display
    song TEXT NOT NULL,
    artist TEXT NOT NULL,
    album TEXT,
    duration_ms INTEGER NOT NULL,

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
    effective_score REAL DEFAULT 0,
    vote_count INTEGER DEFAULT 0,
    diversity_bonus INTEGER DEFAULT 0,
    confidence TEXT CHECK(confidence IN ('low', 'medium', 'high')) DEFAULT 'low',
    score_updated_at INTEGER,

    -- Timestamps
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),
    updated_at INTEGER NOT NULL DEFAULT (unixepoch()),

    -- Submitter info
    submitter_id INTEGER REFERENCES users(id)
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_lyrics_video_id ON lyrics(video_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_song_artist ON lyrics(song_norm, artist_norm);
CREATE INDEX IF NOT EXISTS idx_lyrics_score ON lyrics(score DESC);

-- Votes table (for quality control)
CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lyrics_id INTEGER NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    vote INTEGER CHECK(vote IN (-1, 1)) NOT NULL,
    is_self_vote INTEGER DEFAULT 0,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    UNIQUE(lyrics_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_lyrics ON votes(lyrics_id);
CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);

-- Reports table (for flagging bad lyrics)
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lyrics_id INTEGER NOT NULL REFERENCES lyrics(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    reason TEXT CHECK(reason IN ('wrong_song', 'bad_sync', 'offensive', 'spam', 'other')) NOT NULL,
    details TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch()),

    UNIQUE(lyrics_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_reports_lyrics ON reports(lyrics_id);
CREATE INDEX IF NOT EXISTS idx_lyrics_effective_score ON lyrics(effective_score DESC);
