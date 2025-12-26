const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");

let db;

function ensureSchema(db) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      name TEXT,
      target_url TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const cols = db.prepare("PRAGMA table_info(links)").all().map((c) => c.name);
  if (!cols.includes("name")) {
    db.exec("ALTER TABLE links ADD COLUMN name TEXT");
  }
  if (!cols.includes("logo_mode")) {
    db.exec("ALTER TABLE links ADD COLUMN logo_mode TEXT DEFAULT 'default'");
  }
  if (!cols.includes("logo_path_custom")) {
    db.exec("ALTER TABLE links ADD COLUMN logo_path_custom TEXT");
  }
}

function getDb() {
  if (db) return db;

  const isVercel = process.env.VERCEL === "1" || process.env.VERCEL_ENV;
  let dataDir;
  
  if (isVercel) {
    dataDir = "/tmp";
  } else {
    dataDir = path.join(__dirname, "..", "data");
    fs.mkdirSync(dataDir, { recursive: true });
  }
  
  const dbPath = path.join(dataDir, "qr.db");
  db = new Database(dbPath);
  ensureSchema(db);
  return db;
}

module.exports = { getDb };


