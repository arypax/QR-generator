const path = require("path");
const fs = require("fs");

require("dotenv").config();

const express = require("express");
const multer = require("multer");

const { getDb } = require("./src/db");
const { createQrPngWithLogo } = require("./src/qr");
const { nanoid } = require("nanoid");
const { z } = require("zod");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ENV_BASE_URL = (process.env.BASE_URL || "").trim().replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const DATA_DIR = path.join(__dirname, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_LOGO_PATH = path.join(__dirname, "ales logo.png");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "public")));

function resolveBaseUrl(req) {
  if (ENV_BASE_URL) return ENV_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

function resolveLogoPath(db) {
  if (fs.existsSync(DEFAULT_LOGO_PATH)) return { path: DEFAULT_LOGO_PATH, source: "default" };

  const configured = db.prepare("SELECT value FROM settings WHERE key = 'logo_path'").get()?.value || "";
  if (configured && fs.existsSync(configured)) return { path: configured, source: "uploaded" };
  return { path: "", source: "none" };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.query.token || req.get("x-admin-token") || "";
  if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");
  return next();
}

const upload = multer({
  dest: UPLOADS_DIR,
  limits: { fileSize: 25 * 1024 * 1024 }
});

const targetUrlSchema = z
  .string()
  .trim()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "Only http/https URLs are allowed");

function parseName(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 80) return trimmed.substring(0, 80);
  return trimmed;
}

app.get("/", (req, res) => {
  res.redirect("/admin");
});

app.get("/admin", requireAdmin, (req, res) => {
  const db = getDb();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const perPage = 10;
  const offset = (page - 1) * perPage;
  
  const totalCount = db.prepare("SELECT COUNT(*) as count FROM links").get().count;
  const totalPages = Math.ceil(totalCount / perPage);
  
  const links = db
    .prepare("SELECT id, name, target_url, created_at, updated_at FROM links ORDER BY updated_at DESC LIMIT ? OFFSET ?")
    .all(perPage, offset);
  
  res.render("admin", {
    baseUrl: resolveBaseUrl(req),
    token: req.query.token || "",
    error: req.query.error || "",
    links,
    pagination: {
      page,
      totalPages,
      totalCount,
      perPage
    }
  });
});

app.post("/admin/create", requireAdmin, upload.single("logo_custom"), (req, res) => {
  const db = getDb();
  const token = req.query.token || "";
  const parsed = targetUrlSchema.safeParse(req.body.target_url || "");
  if (!parsed.success) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const nameValue = parseName(req.body.name);
  const logoMode = req.body.logo_mode || "default";
  
  let logoPathCustom = null;
  if (logoMode === "custom" && req.file) {
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    if (!allowed.has(ext)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).send("Supported: PNG/JPG/WEBP");
    }
    const customLogoDir = path.join(DATA_DIR, "custom_logos");
    fs.mkdirSync(customLogoDir, { recursive: true });
    const target = path.join(customLogoDir, `${nanoid(12)}${ext}`);
    try {
      fs.renameSync(req.file.path, target);
    } catch {
      fs.copyFileSync(req.file.path, target);
      fs.unlinkSync(req.file.path);
    }
    logoPathCustom = target;
  } else if (req.file) {
    fs.unlinkSync(req.file.path);
  }
  
  const id = nanoid(8);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO links (id, name, target_url, logo_mode, logo_path_custom, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    id,
    nameValue,
    parsed.data,
    logoMode,
    logoPathCustom,
    now,
    now
  );
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

app.post("/admin/:id/update", requireAdmin, (req, res) => {
  const db = getDb();
  const token = req.query.token || "";
  const id = String(req.params.id || "");
  const now = new Date().toISOString();
  
  if (req.body.target_url !== undefined) {
    const parsed = targetUrlSchema.safeParse(req.body.target_url || "");
    if (!parsed.success) {
      return res.status(400).send(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const info = db.prepare("UPDATE links SET target_url = ?, updated_at = ? WHERE id = ?").run(parsed.data, now, id);
    if (info.changes === 0) return res.status(404).send("Not found");
  }
  
  if (req.body.name !== undefined) {
    const nameValue = parseName(req.body.name);
    const info = db.prepare("UPDATE links SET name = ?, updated_at = ? WHERE id = ?").run(nameValue, now, id);
    if (info.changes === 0) return res.status(404).send("Not found");
  }
  
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

app.post("/admin/:id/delete", requireAdmin, (req, res) => {
  const db = getDb();
  const token = req.query.token || "";
  const id = String(req.params.id || "");
  db.prepare("DELETE FROM links WHERE id = ?").run(id);
  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

app.post("/admin/logo", requireAdmin, upload.single("logo"), async (req, res) => {
  const db = getDb();
  const token = req.query.token || "";
  if (!req.file) return res.status(400).send("No file uploaded");

  const ext = path.extname(req.file.originalname || "").toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  if (!allowed.has(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).send("Supported: PNG/JPG/WEBP");
  }

  const target = path.join(DATA_DIR, `logo${ext}`);
  try {
    fs.renameSync(req.file.path, target);
  } catch {
    fs.copyFileSync(req.file.path, target);
    fs.unlinkSync(req.file.path);
  }

  db.prepare("INSERT INTO settings (key, value) VALUES ('logo_path', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .run(target);

  res.redirect(`/admin?token=${encodeURIComponent(token)}`);
});

app.get("/qr/:id.png", async (req, res) => {
  const db = getDb();
  const id = String(req.params.id || "");
  const row = db.prepare("SELECT id, target_url, logo_mode, logo_path_custom FROM links WHERE id = ?").get(id);
  if (!row) return res.status(404).send("Not found");

  let logoPath = null;
  if (row.logo_mode === "default") {
    const logo = resolveLogoPath(db);
    logoPath = logo.path || null;
  } else if (row.logo_mode === "custom" && row.logo_path_custom && fs.existsSync(row.logo_path_custom)) {
    logoPath = row.logo_path_custom;
  }

  try {
    const png = await createQrPngWithLogo({
      text: row.target_url,
      logoPath: logoPath,
      size: 1024,
      logoMode: row.logo_mode
    });
    res.setHeader("Content-Type", "image/png");
    if (String(req.query.download || "") === "1") {
      res.setHeader("Content-Disposition", `attachment; filename="qr-${row.id}.png"`);
    }
    res.setHeader("Cache-Control", "no-store");
    res.send(png);
  } catch (e) {
    res.status(500).send(`QR generation failed: ${e?.message || e}`);
  }
});

app.get("/r/:id", (req, res) => {
  const db = getDb();
  const id = String(req.params.id || "");
  const row = db.prepare("SELECT target_url FROM links WHERE id = ?").get(id);
  if (!row) return res.status(404).send("Not found");
  res.redirect(302, row.target_url);
});

app.use((err, req, res, next) => {
  if (err && (err.code === "LIMIT_FILE_SIZE" || err.name === "MulterError")) {
    const token = req.query?.token ? `token=${encodeURIComponent(req.query.token)}` : "";
    const qs = token ? `?${token}&error=file_too_large` : `?error=file_too_large`;
    return res.redirect(`/admin${qs}`);
  }
  return next(err);
});

function startListen(port, attempt = 0) {
  const server = app.listen(port, () => {
    console.log(`QR generator running on port ${port}${ENV_BASE_URL ? ` (${ENV_BASE_URL})` : ""}`);
    if (ADMIN_TOKEN) console.log("Admin token protection: ENABLED");
    else console.log("Admin token protection: DISABLED (set ADMIN_TOKEN in .env to enable)");
  });

  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE" && attempt < 20) {
      const next = port + 1;
      console.warn(`Port ${port} is busy, trying ${next}...`);
      return startListen(next, attempt + 1);
    }
    throw err;
  });
}

startListen(PORT);