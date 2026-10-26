import Database from 'better-sqlite3'

export type DB = Database.Database

/** Each entry upgrades the schema by one version (PRAGMA user_version). */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE sessions (
    token_hash   TEXT PRIMARY KEY,
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    renewed_at   INTEGER NOT NULL,
    user_agent   TEXT
  );

  CREATE TABLE git_tokens (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    token_hash   TEXT NOT NULL UNIQUE,
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER
  );

  -- Public image URL /images/{hash} -> git blob. path is where the file lives in the repo.
  CREATE TABLE images (
    hash       TEXT PRIMARY KEY,
    blob_oid   TEXT NOT NULL,
    path       TEXT NOT NULL,
    mime       TEXT NOT NULL,
    size       INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX images_blob ON images(blob_oid);

  -- Rebuilt from the published commit on every publish.
  CREATE TABLE series_index (
    slug        TEXT PRIMARY KEY,
    title       TEXT NOT NULL,
    description TEXT NOT NULL,
    cover       TEXT,
    sort        INTEGER NOT NULL
  );

  CREATE TABLE article_index (
    series      TEXT NOT NULL,
    chapter     INTEGER NOT NULL,
    title       TEXT NOT NULL,
    summary     TEXT NOT NULL,
    tags        TEXT NOT NULL,
    cover       TEXT,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    PRIMARY KEY (series, chapter)
  );
  `,
  `
  -- Full-text index over published chapters. trigram works for CJK substrings.
  CREATE VIRTUAL TABLE search_fts USING fts5(
    series UNINDEXED,
    chapter UNINDEXED,
    title,
    tags,
    body,
    tokenize = 'trigram'
  );

  -- Fingerprint (content + meta blob oids) of what each chapter's search row was built from.
  -- Publishing only re-indexes chapters whose fingerprint changed.
  CREATE TABLE search_state (
    series      TEXT NOT NULL,
    chapter     INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    PRIMARY KEY (series, chapter)
  );
  `,
  `
  -- Predefined tag catalog. The key is stable across renames; articles keep tag names in meta.yaml.
  CREATE TABLE tags (
    key        TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );
  `,
  `
  -- Article theme color as published: {"light": "#rrggbb", "dark": "#rrggbb"} or NULL.
  ALTER TABLE article_index ADD COLUMN theme TEXT;

  -- Uploaded site images (home background, per mode). Stored as webp.
  CREATE TABLE media (
    key        TEXT PRIMARY KEY,
    mime       TEXT NOT NULL,
    data       BLOB NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  `
  -- The home background image was removed; its table goes with it.
  DROP TABLE media;
  `,
  `
  -- Items the admin pinned to the top of the home list. Applies immediately, not versioned.
  -- key: "<series>/<n>" for an article, the slug for a series, the catalog key for a tag.
  CREATE TABLE pins (
    kind       TEXT NOT NULL CHECK (kind IN ('article', 'series', 'tag')),
    key        TEXT NOT NULL,
    sort       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (kind, key)
  );

  -- Custom pages (_pages/<slug>/) of the published commit. Rebuilt on every publish.
  CREATE TABLE page_index (
    slug  TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    kind  TEXT NOT NULL
  );
  `,
  `
  -- The GitHub Discussion that holds an article's comments. One per article path, created on the first comment.
  CREATE TABLE comment_threads (
    series        TEXT NOT NULL,
    chapter       INTEGER NOT NULL,
    discussion_id TEXT NOT NULL,
    number        INTEGER NOT NULL,
    url           TEXT NOT NULL,
    created_at    INTEGER NOT NULL,
    PRIMARY KEY (series, chapter)
  );
  `,
  `
  -- Share links: <origin>/sh/<id> redirects to the article's published version. id is 4 letters or digits.
  CREATE TABLE share_links (
    id         TEXT PRIMARY KEY,
    series     TEXT NOT NULL,
    chapter    INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX share_links_article ON share_links(series, chapter);
  `,
  `
  -- Visitor links: the one link every reader of an article gets. Admin links have visitor = 0.
  -- At most one visitor link per article.
  ALTER TABLE share_links ADD COLUMN visitor INTEGER NOT NULL DEFAULT 0;
  CREATE UNIQUE INDEX share_links_visitor ON share_links(series, chapter) WHERE visitor = 1;
  `,
]

export function openDb(file: string): DB {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

function migrate(db: DB) {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

export function getSetting(db: DB, key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

export function setSetting(db: DB, key: string, value: string) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value)
}
