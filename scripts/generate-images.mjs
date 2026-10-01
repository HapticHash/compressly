// Renders the PWA icons and the social preview image (public/og-image.png).
// Run with: node scripts/generate-images.mjs
import { chromium } from "@playwright/test";
import fs from "node:fs";

const svg = fs.readFileSync("public/favicon.svg", "utf8");
const browser = await chromium.launch();
const page = await browser.newPage();

async function renderIcon(size, file, padding = 0) {
  await page.setViewportSize({ width: size, height: size });
  const inner = size - padding * 2;
  await page.setContent(
    `<body style="margin:0;background:${padding ? "#606c38" : "transparent"}">` +
      `<div style="padding:${padding}px;width:${inner}px;height:${inner}px">${svg.replace("<svg ", `<svg width="${inner}" height="${inner}" `)}</div></body>`,
  );
  await page.screenshot({ path: file, omitBackground: !padding });
}

await renderIcon(192, "public/icons/icon-192.png");
await renderIcon(512, "public/icons/icon-512.png");
// Maskable icons need the artwork inside the central 80% safe zone.
await renderIcon(512, "public/icons/icon-maskable-512.png", 52);
await renderIcon(180, "public/icons/apple-touch-icon.png", 14);

await page.setViewportSize({ width: 1200, height: 630 });
await page.setContent(`
  <body style="margin:0;width:1200px;height:630px;background:#fefae0;font-family:'Nunito Sans',system-ui,sans-serif;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden">
    <div style="position:absolute;top:-200px;left:-150px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(96,108,56,.18),transparent 70%)"></div>
    <div style="position:absolute;bottom:-250px;right:-150px;width:700px;height:700px;border-radius:50%;background:radial-gradient(circle,rgba(188,108,37,.18),transparent 70%)"></div>
    <div style="text-align:center;position:relative">
      <div style="display:inline-block;margin-bottom:28px">${svg.replace("<svg ", '<svg width="120" height="120" ')}</div>
      <div style="font-size:104px;font-weight:800;color:#283618;letter-spacing:-2px">Compressly</div>
      <div style="font-size:38px;color:#394021;margin-top:12px">Shrink PDFs, images &amp; videos. Nothing is uploaded.</div>
      <div style="margin-top:36px;display:flex;gap:14px;justify-content:center">
        ${["PDF", "JPG", "HEIC", "WebP", "MP4", "GIF"].map((t) => `<span style="font-size:26px;font-weight:700;color:#bc6c25;border:3px solid #dda15e;border-radius:999px;padding:8px 22px;background:#fff">${t}</span>`).join("")}
      </div>
    </div>
  </body>`);
await page.screenshot({ path: "public/og-image.png" });
await browser.close();
console.log("Generated icons and og-image.png");
