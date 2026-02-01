const path = require("path");
const fs = require("fs");
const os = require("os");

require("dotenv").config();

const express = require("express");
const multer = require("multer");
const session = require("express-session");
const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;

const { createStore } = require("./src/store");
const { createQrPngWithLogo } = require("./src/qr");
const { nanoid } = require("nanoid");
const { z } = require("zod");

const app = express();

const PORT = Number(process.env.PORT || 3000);
const ENV_BASE_URL = (process.env.BASE_URL || "").trim().replace(/\/+$/, "");
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";

const UPLOADS_DIR =
  (process.env.UPLOADS_DIR && String(process.env.UPLOADS_DIR).trim()) ||
  path.join(os.tmpdir(), "qr-generator-uploads");
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const DEFAULT_LOGO_PATH = path.join(__dirname, "ales logo.png");

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));

app.set("trust proxy", 1);

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use("/static", express.static(path.join(__dirname, "public")));

const SESSION_SECRET = process.env.SESSION_SECRET || "";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

if (SESSION_SECRET) {
  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production"
      }
    })
  );
  app.use(passport.initialize());
  app.use(passport.session());
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

function oauthEnabled() {
  return !!(SESSION_SECRET && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

if (oauthEnabled()) {
  const base = 'https://qr-generator-0yne.onrender.com';
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `${base}/auth/google/callback`
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const store = await getStore();
          const now = new Date().toISOString();
          const email = profile.emails?.[0]?.value || "";
          const name = profile.displayName || "";
          const picture = profile.photos?.[0]?.value || "";
          const id = String(profile.id || "");
          await store.getOrCreateUser({ id, email, name, picture, now });
          await store.claimLegacyLinksIfEmptyUser({ userId: id });
          return done(null, { id, email, name, picture });
        } catch (e) {
          return done(e);
        }
      }
    )
  );
}

function resolveBaseUrl(req) {
  if (ENV_BASE_URL) return ENV_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "http";
  const host = req.get("host");
  return `${proto}://${host}`.replace(/\/+$/, "");
}

let storePromise;
function getStore() {
  if (!storePromise) storePromise = createStore();
  return storePromise;
}

async function resolveDefaultLogo(store) {
  const blob = await store.getSettingBlob({ key: "logo_blob" });
  if (blob && blob.blob) {
    return { buffer: Buffer.from(blob.blob), source: "uploaded-blob" };
  }

  const configured = await store.getSettingText({ key: "logo_path" });
  if (configured && fs.existsSync(configured)) return { path: configured, source: "uploaded-path" };
  if (fs.existsSync(DEFAULT_LOGO_PATH)) return { path: DEFAULT_LOGO_PATH, source: "default" };
  return { path: "", source: "none" };
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) return next();
  const token = req.query.token || req.get("x-admin-token") || "";
  if (token !== ADMIN_TOKEN) return res.status(401).send("Unauthorized");
  return next();
}

function requireAuth(req, res, next) {
  if (oauthEnabled()) {
    if (req.isAuthenticated && req.isAuthenticated()) return next();
    return res.redirect("/login");
  }

  const token = req.query.token || req.get("x-admin-token") || "";
  if (ADMIN_TOKEN && token === ADMIN_TOKEN) {
    req.user = { id: "admin", email: "admin" };
    return next();
  }

  return res.status(401).send("Unauthorized");
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

app.get("/login", (req, res) => {
  if (oauthEnabled() && req.isAuthenticated && req.isAuthenticated()) return res.redirect("/admin");
  return res.render("login");
});

app.get("/auth/google", (req, res, next) => {
  if (!oauthEnabled()) return res.status(500).send("Auth is not configured");
  return passport.authenticate("google", { scope: ["profile", "email"] })(req, res, next);
});

app.get("/auth/google/callback", (req, res, next) => {
  if (!oauthEnabled()) return res.status(500).send("Auth is not configured");

  passport.authenticate("google", (err, user) => {
    if (err) {
      console.error("Google OAuth error:", err);
      return res.status(500).send(err.message || String(err));
    }
    if (!user) return res.redirect("/login");
    req.logIn(user, (e) => (e ? next(e) : res.redirect("/admin")));
  })(req, res, next);
});

app.post("/logout", (req, res, next) => {
  // Passport 0.6+ requires callback for req.logout
  const finish = () => {
    if (!req.session) return res.redirect("/login");
    req.session.destroy((err) => {
      if (err) return next(err);
      return res.redirect("/login");
    });
  };

  try {
    if (!req.logout) return finish();
    return req.logout((err) => {
      if (err) return next(err);
      return finish();
    });
  } catch (err) {
    return next(err);
  }
});

app.get("/admin", requireAuth, async (req, res) => {
  const store = await getStore();
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const perPage = 10;

  const userId = req.user.id;
  const { links, totalCount, totalPages } = await store.getLinksPage({ userId, page, perPage });

  res.render("admin", {
    baseUrl: resolveBaseUrl(req),
    token: req.query.token || "",
    error: req.query.error || "",
    links,
    user: req.user,
    pagination: {
      page,
      totalPages,
      totalCount,
      perPage
    }
  });
});

app.post("/admin/create", requireAuth, upload.single("logo_custom"), async (req, res) => {
  const store = await getStore();
  const token = req.query.token || "";
  const parsed = targetUrlSchema.safeParse(req.body.target_url || "");
  if (!parsed.success) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).send(parsed.error.issues.map((i) => i.message).join("; "));
  }
  const nameValue = parseName(req.body.name);
  const logoMode = req.body.logo_mode || "default";
  
  let logoCustomBlob = null;
  let logoCustomMime = null;
  if (logoMode === "custom" && req.file) {
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
    if (!allowed.has(ext)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).send("Supported: PNG/JPG/WEBP");
    }
    logoCustomBlob = fs.readFileSync(req.file.path);
    logoCustomMime = req.file.mimetype || "";
    fs.unlinkSync(req.file.path);
  } else if (req.file) {
    fs.unlinkSync(req.file.path);
  }
  
  const id = nanoid(8);
  const now = new Date().toISOString();
  await store.createLink({
    userId: req.user.id,
    id,
    name: nameValue,
    targetUrl: parsed.data,
    logoMode,
    logoCustomBlob,
    logoCustomMime,
    now
  });
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  res.redirect(`/admin${qs}`);
});

app.post("/admin/:id/update", requireAuth, async (req, res) => {
  const store = await getStore();
  const token = req.query.token || "";
  const id = String(req.params.id || "");
  const now = new Date().toISOString();
  
  if (req.body.target_url !== undefined) {
    const parsed = targetUrlSchema.safeParse(req.body.target_url || "");
    if (!parsed.success) {
      return res.status(400).send(parsed.error.issues.map((i) => i.message).join("; "));
    }
    const changes = await store.updateTargetUrl({ userId: req.user.id, id, targetUrl: parsed.data, now });
    if (changes === 0) return res.status(404).send("Not found");
  }
  
  if (req.body.name !== undefined) {
    const nameValue = parseName(req.body.name);
    const changes = await store.updateName({ userId: req.user.id, id, name: nameValue, now });
    if (changes === 0) return res.status(404).send("Not found");
  }
  
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  res.redirect(`/admin${qs}`);
});

app.post("/admin/:id/delete", requireAuth, async (req, res) => {
  const store = await getStore();
  const token = req.query.token || "";
  const id = String(req.params.id || "");
  await store.deleteLink({ userId: req.user.id, id });
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  res.redirect(`/admin${qs}`);
});

app.post("/admin/logo", requireAuth, upload.single("logo"), async (req, res) => {
  const store = await getStore();
  const token = req.query.token || "";
  if (!req.file) return res.status(400).send("No file uploaded");

  const ext = path.extname(req.file.originalname || "").toLowerCase();
  const allowed = new Set([".png", ".jpg", ".jpeg", ".webp"]);
  if (!allowed.has(ext)) {
    fs.unlinkSync(req.file.path);
    return res.status(400).send("Supported: PNG/JPG/WEBP");
  }

  const logoBlob = fs.readFileSync(req.file.path);
  const logoMime = req.file.mimetype || "";
  fs.unlinkSync(req.file.path);

  await store.upsertSettingBlob({ key: `user:${req.user.id}:logo_blob`, blob: logoBlob, mime: logoMime });
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  res.redirect(`/admin${qs}`);
});

app.get("/qr/:id.png", async (req, res) => {
  const store = await getStore();
  const id = String(req.params.id || "");
  const row = await store.getLinkForQr({ id });
  if (!row) return res.status(404).send("Not found");

  let logoPath = null;
  let logoBuffer = null;
  if (row.logo_mode === "default") {
    logoPath = fs.existsSync(DEFAULT_LOGO_PATH) ? DEFAULT_LOGO_PATH : null;
  } else if (row.logo_mode === "custom") {
    if (row.logo_custom_blob) {
      logoBuffer = Buffer.from(row.logo_custom_blob);
    } else if (row.logo_path_custom && fs.existsSync(row.logo_path_custom)) {
      logoPath = row.logo_path_custom;
    }
  }

  try {
    const png = await createQrPngWithLogo({
      text: row.target_url,
      logoPath,
      logoBuffer,
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

app.get("/r/:id", async (req, res) => {
  const store = await getStore();
  const id = String(req.params.id || "");
  const targetUrl = await store.getTargetUrl({ id });
  if (!targetUrl) return res.status(404).send("Not found");
  res.redirect(302, targetUrl);
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

if (require.main === module) {
  startListen(PORT);
}

module.exports = app;