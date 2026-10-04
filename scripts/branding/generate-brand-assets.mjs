#!/usr/bin/env node
/**
 * StudyUs brand assets (branding only). Deterministic and re-runnable on any
 * baseline: writes the full wordmark and the compact "SU" mark from the
 * sources in scripts/branding/source.
 *
 *   node scripts/branding/generate-brand-assets.mjs
 *
 * Outputs (all versioned file names, so browsers never keep the old StudyUS art):
 *   public/brand/studyus-wordmark-v2.png     full wordmark (transparent)
 *   public/brand/su-icon-192.png, su-icon-512.png, su-icon-maskable-512.png (manifest / PWA)
 *   src/app/icon.png      512x512   Next.js file-based icon (hashed URL)
 *   src/app/apple-icon.png 180x180  Apple touch icon (opaque)
 *   src/app/favicon.ico   16/32/48  PNG-compressed ICO
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEAL = '#1F524D'; // sampled from the StudyUs wordmark
const at = (p) => join(ROOT, p);

/** The compact mark: bold "SU" on the brand teal (rounded square, like the previous app icon). */
function suSvg(size, { rounded = true, padding = 0 } = {}) {
  const r = rounded ? Math.round(size * 0.22) : 0;
  const inner = size - padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${padding}" y="${padding}" width="${inner}" height="${inner}" rx="${r}" fill="${TEAL}"/>
  <text x="50%" y="50%" dy="0.355em" text-anchor="middle" fill="#FFFFFF"
        font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="800"
        font-size="${Math.round(inner * 0.5)}" letter-spacing="${(-inner * 0.02).toFixed(1)}">SU</text>
</svg>`;
}

const png = (svg) => sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();

/** ICO container with PNG-compressed entries (supported by every current browser). */
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2);
    dir.writeUInt8(0, o + 3);
    dir.writeUInt16LE(1, o + 4);
    dir.writeUInt16LE(32, o + 6);
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

async function main() {
  mkdirSync(at('public/brand'), { recursive: true });
  // Full wordmark: the approved StudyUs artwork, unchanged composition, re-encoded as PNG.
  const wordmark = await sharp(readFileSync(at('scripts/branding/source/studyus-wordmark.webp'))).png({ compressionLevel: 9 }).toBuffer();
  writeFileSync(at('public/brand/studyus-wordmark-v2.png'), wordmark);
  // Compact SU mark.
  writeFileSync(at('src/app/icon.png'), await png(suSvg(512)));
  writeFileSync(at('src/app/apple-icon.png'), await png(suSvg(180, { rounded: false })));
  writeFileSync(at('public/brand/su-icon-192.png'), await png(suSvg(192)));
  writeFileSync(at('public/brand/su-icon-512.png'), await png(suSvg(512)));
  writeFileSync(at('public/brand/su-icon-maskable-512.png'), await png(suSvg(512, { rounded: false })));
  const sizes = [16, 32, 48];
  writeFileSync(at('src/app/favicon.ico'), ico(await Promise.all(sizes.map(async (size) => ({ size, data: await png(suSvg(size)) })))));
  console.log('brand assets written');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
