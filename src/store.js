const fs = require("fs");
const path = require("path");

const { getDb } = require("./db");

function isPgEnabled() {
  return !!(process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim());
}

async function createPgPool() {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSLMODE === "disable" ? false : { rejectUnauthorized: false }
  });
  return pool;
}

async function ensurePgSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS links (
      id TEXT PRIMARY KEY,
      name TEXT,
      target_url TEXT NOT NULL,
      logo_mode TEXT DEFAULT 'default',
      logo_custom_blob BYTEA,
      logo_custom_mime TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      value_blob BYTEA,
      value_mime TEXT
    );
  `);

  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS logo_mode TEXT DEFAULT 'default';`);
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS logo_custom_blob BYTEA;`);
  await pool.query(`ALTER TABLE links ADD COLUMN IF NOT EXISTS logo_custom_mime TEXT;`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS value_blob BYTEA;`);
  await pool.query(`ALTER TABLE settings ADD COLUMN IF NOT EXISTS value_mime TEXT;`);
}

function ensureSqliteSchemaExtras(db) {
  const linkCols = db.prepare("PRAGMA table_info(links)").all().map((c) => c.name);
  if (!linkCols.includes("logo_mode")) db.exec("ALTER TABLE links ADD COLUMN logo_mode TEXT DEFAULT 'default'");
  if (!linkCols.includes("logo_custom_blob")) db.exec("ALTER TABLE links ADD COLUMN logo_custom_blob BLOB");
  if (!linkCols.includes("logo_custom_mime")) db.exec("ALTER TABLE links ADD COLUMN logo_custom_mime TEXT");

  const settingsCols = db.prepare("PRAGMA table_info(settings)").all().map((c) => c.name);
  if (!settingsCols.includes("value_blob")) db.exec("ALTER TABLE settings ADD COLUMN value_blob BLOB");
  if (!settingsCols.includes("value_mime")) db.exec("ALTER TABLE settings ADD COLUMN value_mime TEXT");
}

async function createStore() {
  if (isPgEnabled()) {
    const pool = await createPgPool();
    await ensurePgSchema(pool);

    return {
      kind: "pg",
      async getLinksPage({ page, perPage }) {
        const offset = (page - 1) * perPage;
        const totalRes = await pool.query("SELECT COUNT(*)::int as count FROM links");
        const totalCount = totalRes.rows[0]?.count || 0;
        const totalPages = Math.max(1, Math.ceil(totalCount / perPage));

        const linksRes = await pool.query(
          "SELECT id, name, target_url, created_at, updated_at FROM links ORDER BY updated_at DESC LIMIT $1 OFFSET $2",
          [perPage, offset]
        );
        return { links: linksRes.rows, totalCount, totalPages };
      },

      async createLink({ id, name, targetUrl, logoMode, logoCustomBlob, logoCustomMime, now }) {
        await pool.query(
          `INSERT INTO links (id, name, target_url, logo_mode, logo_custom_blob, logo_custom_mime, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, name, targetUrl, logoMode, logoCustomBlob, logoCustomMime, now, now]
        );
      },

      async updateTargetUrl({ id, targetUrl, now }) {
        const res = await pool.query("UPDATE links SET target_url = $1, updated_at = $2 WHERE id = $3", [targetUrl, now, id]);
        return res.rowCount;
      },

      async updateName({ id, name, now }) {
        const res = await pool.query("UPDATE links SET name = $1, updated_at = $2 WHERE id = $3", [name, now, id]);
        return res.rowCount;
      },

      async deleteLink({ id }) {
        const res = await pool.query("DELETE FROM links WHERE id = $1", [id]);
        return res.rowCount;
      },

      async getLinkForQr({ id }) {
        const res = await pool.query(
          "SELECT id, target_url, logo_mode, logo_custom_blob, logo_custom_mime FROM links WHERE id = $1",
          [id]
        );
        return res.rows[0] || null;
      },

      async getTargetUrl({ id }) {
        const res = await pool.query("SELECT target_url FROM links WHERE id = $1", [id]);
        return res.rows[0]?.target_url || null;
      },

      async getSettingText({ key }) {
        const res = await pool.query("SELECT value FROM settings WHERE key = $1", [key]);
        return res.rows[0]?.value ?? null;
      },

      async upsertSettingBlob({ key, blob, mime }) {
        await pool.query(
          `INSERT INTO settings (key, value, value_blob, value_mime)
           VALUES ($1,'',$2,$3)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_blob = excluded.value_blob, value_mime = excluded.value_mime`,
          [key, blob, mime]
        );
      },

      async getSettingBlob({ key }) {
        const res = await pool.query("SELECT value_blob, value_mime FROM settings WHERE key = $1", [key]);
        const row = res.rows[0];
        if (!row || !row.value_blob) return null;
        return { blob: row.value_blob, mime: row.value_mime || "" };
      }
    };
  }

  const db = getDb();
  ensureSqliteSchemaExtras(db);

  return {
    kind: "sqlite",
    async getLinksPage({ page, perPage }) {
      const offset = (page - 1) * perPage;
      const totalCount = db.prepare("SELECT COUNT(*) as count FROM links").get().count;
      const totalPages = Math.max(1, Math.ceil(totalCount / perPage));
      const links = db
        .prepare("SELECT id, name, target_url, created_at, updated_at FROM links ORDER BY updated_at DESC LIMIT ? OFFSET ?")
        .all(perPage, offset);
      return { links, totalCount, totalPages };
    },

    async createLink({ id, name, targetUrl, logoMode, logoCustomBlob, logoCustomMime, now }) {
      db.prepare(
        "INSERT INTO links (id, name, target_url, logo_mode, logo_custom_blob, logo_custom_mime, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, name, targetUrl, logoMode, logoCustomBlob, logoCustomMime, now, now);
    },

    async updateTargetUrl({ id, targetUrl, now }) {
      const info = db.prepare("UPDATE links SET target_url = ?, updated_at = ? WHERE id = ?").run(targetUrl, now, id);
      return info.changes || 0;
    },

    async updateName({ id, name, now }) {
      const info = db.prepare("UPDATE links SET name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
      return info.changes || 0;
    },

    async deleteLink({ id }) {
      const info = db.prepare("DELETE FROM links WHERE id = ?").run(id);
      return info.changes || 0;
    },

    async getLinkForQr({ id }) {
      return (
        db
          .prepare("SELECT id, target_url, logo_mode, logo_custom_blob, logo_custom_mime, logo_path_custom FROM links WHERE id = ?")
          .get(id) || null
      );
    },

    async getTargetUrl({ id }) {
      const row = db.prepare("SELECT target_url FROM links WHERE id = ?").get(id);
      return row?.target_url || null;
    },

    async getSettingText({ key }) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return row?.value ?? null;
    },

    async upsertSettingBlob({ key, blob, mime }) {
      db.prepare(
        "INSERT INTO settings (key, value, value_blob, value_mime) VALUES (?, '', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, value_blob = excluded.value_blob, value_mime = excluded.value_mime"
      ).run(key, blob, mime);
    },

    async getSettingBlob({ key }) {
      const row = db.prepare("SELECT value_blob, value_mime FROM settings WHERE key = ?").get(key);
      if (!row || !row.value_blob) return null;
      return { blob: row.value_blob, mime: row.value_mime || "" };
    }
  };
}

module.exports = { createStore, isPgEnabled };


