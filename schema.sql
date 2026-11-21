CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  category TEXT DEFAULT 'DAYZ MOD',
  version TEXT DEFAULT '',
  status TEXT DEFAULT 'idea',
  priority TEXT DEFAULT 'medium',
  tags TEXT DEFAULT '[]',
  visibility TEXT NOT NULL DEFAULT 'public',
  password_salt TEXT,
  password_hash TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL,
  name TEXT DEFAULT '',
  content_type TEXT DEFAULT 'image/jpeg'
);
CREATE INDEX IF NOT EXISTS idx_projects_visibility_updated ON projects(visibility, updated DESC);
CREATE INDEX IF NOT EXISTS idx_images_project ON images(project_id);


-- Steam account and optional Discord profile link
CREATE TABLE IF NOT EXISTS users (
  steamid TEXT PRIMARY KEY,
  discord_id TEXT UNIQUE,
  discord_username TEXT,
  discord_avatar TEXT,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS steam_nonces (nonce TEXT PRIMARY KEY, created INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS idx_steam_nonces_created ON steam_nonces(created);
