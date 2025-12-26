const fs = require("fs");
const QRCode = require("qrcode");
const sharp = require("sharp");

function clamp01(x) {
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

function hexToRgb(hex) {
  const h = String(hex || "").replace("#", "").trim();
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(v, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const to2 = (x) => x.toString(16).padStart(2, "0");
  return `#${to2(r)}${to2(g)}${to2(b)}`.toUpperCase();
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function lerpColorHex(fromHex, toHex, t) {
  const a = hexToRgb(fromHex);
  const b = hexToRgb(toHex);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t))
  });
}

function isInFinder(x, y, n) {
  const inTopLeft = x >= 0 && x <= 6 && y >= 0 && y <= 6;
  const inTopRight = x >= n - 7 && x <= n - 1 && y >= 0 && y <= 6;
  const inBottomLeft = x >= 0 && x <= 6 && y >= n - 7 && y <= n - 1;
  return inTopLeft || inTopRight || inBottomLeft;
}

async function createColoredQrPng({ text, size = 1024 }) {
  const marginModules = 2;
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const modulePx = Math.max(1, Math.ceil(size / (n + marginModules * 2)));
  const canvasPx = (n + marginModules * 2) * modulePx;

  const BLUE = "#0499E9";
  const RED = "#F42828";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasPx}" height="${canvasPx}" viewBox="0 0 ${canvasPx} ${canvasPx}" shape-rendering="crispEdges">`;
  svg += `<rect width="${canvasPx}" height="${canvasPx}" fill="#FFFFFF"/>`;

  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const dark = qr.modules.get(x, y);
      if (!dark) continue;

      let color;
      if (isInFinder(x, y, n)) {
        color = BLUE;
      } else {
        const t = clamp01(x / (n - 1));
        color = lerpColorHex(BLUE, RED, t);
      }

      const px = (x + marginModules) * modulePx;
      const py = (y + marginModules) * modulePx;
      svg += `<rect x="${px}" y="${py}" width="${modulePx}" height="${modulePx}" fill="${color}"/>`;
    }
  }

  svg += `</svg>`;
  const buf = await sharp(Buffer.from(svg))
    .resize(size, size, { fit: "fill", kernel: sharp.kernel.nearest })
    .png()
    .toBuffer();
  return buf;
}

async function createQrPngWithLogo({ text, logoPath, logoBuffer, size = 1024, logoMode = null }) {
  let qrPng;
  if (logoMode === "default") {
    qrPng = await createColoredQrPng({ text, size });
  } else {
    qrPng = await QRCode.toBuffer(text, {
      type: "png",
      width: size,
      margin: 2,
      errorCorrectionLevel: "H",
      color: { dark: "#000000", light: "#FFFFFF" }
    });
  }

  const hasBuf = !!(logoBuffer && Buffer.isBuffer(logoBuffer) && logoBuffer.length > 0);
  if (!hasBuf && !logoPath) return qrPng;
  if (!hasBuf && logoPath && !fs.existsSync(logoPath)) return qrPng;
  const qr = sharp(qrPng);
  const qrMeta = await qr.metadata();
  const qrSize = Math.min(qrMeta.width || size, qrMeta.height || size);

  // Keep logo small enough to preserve scanability; add white plate behind it.
  const logoMax = Math.round(qrSize * 0.30);
  const plateSize = Math.round(logoMax * 1.35);
  const radius = Math.round(plateSize * 0.18);

  // Resize logo to fit within area without cropping
  const logoBuf = await sharp(hasBuf ? logoBuffer : logoPath)
    .resize(logoMax, logoMax, { 
      fit: "contain",
      background: { r: 255, g: 255, b: 255, alpha: 0 }
    })
    .png()
    .toBuffer();

  // Rounded white plate SVG
  const plateSvg = Buffer.from(
    `<svg width="${plateSize}" height="${plateSize}" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="${plateSize}" height="${plateSize}" rx="${radius}" ry="${radius}" fill="#FFFFFF"/>
    </svg>`
  );

  const center = Math.floor(qrSize / 2);
  const plateLeft = center - Math.floor(plateSize / 2);
  const plateTop = center - Math.floor(plateSize / 2);

  // Use logoMax for positioning to ensure exact size
  const logoLeft = center - Math.floor(logoMax / 2);
  const logoTop = center - Math.floor(logoMax / 2);

  return await qr
    .composite([
      { input: plateSvg, left: plateLeft, top: plateTop },
      { input: logoBuf, left: logoLeft, top: logoTop }
    ])
    .png()
    .toBuffer();
}

module.exports = { createQrPngWithLogo };


