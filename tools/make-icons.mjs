#!/usr/bin/env node
/**
 * make-icons.mjs — gera os ícones do app (32/128/256 + .ico + .icns) a partir
 * da textura do bloco de grama copiada do jogo, sem depender de nenhuma lib.
 *
 * Uso: node tools/make-icons.mjs
 */
import { deflateSync, inflateSync } from "node:zlib";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "src/assets/minecraft/icons/grass_block_top.png");
const OUT_DIR = join(process.cwd(), "src-tauri/icons");

// ------------------------------------------------------------ leitor de PNG
function readPng(file) {
  const b = readFileSync(file);
  let p = 8;
  let w = 0, h = 0, bitDepth = 0, colorType = 0, plte = [], trns = null;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString("ascii", p + 4, p + 8);
    const data = b.subarray(p + 8, p + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "PLTE") {
      for (let i = 0; i < data.length; i += 3) plte.push([data[i], data[i + 1], data[i + 2]]);
    } else if (type === "tRNS") {
      trns = data;
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    }
    p += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 3 && colorType !== 0)) throw new Error("PNG inesperado");
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    for (let i = 0; i < stride; i++) {
      const a = i > 0 ? line[i - 1] : 0;
      const bb = prev[i];
      const c = i > 0 ? prev[i - 1] : 0;
      if (ft === 1) line[i] = (line[i] + a) & 255;
      else if (ft === 2) line[i] = (line[i] + bb) & 255;
      else if (ft === 3) line[i] = (line[i] + ((a + bb) >> 1)) & 255;
      else if (ft === 4) {
        const pa = Math.abs(bb - c), pb = Math.abs(a - c), pc = Math.abs(a + bb - 2 * c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? bb : c;
        line[i] = (line[i] + pr) & 255;
      }
    }
    line.copy(out, y * stride);
    prev = line;
  }
  // colorType 3 (paleta) ou 0 (escala de cinza): ambos com 1 byte por pixel
  return {
    w,
    h,
    pixel: (x, y) => {
      const idx = out[y * stride + x];
      if (colorType === 3) {
        const rgb = plte[idx] ?? [0, 0, 0];
        return [...rgb, 255];
      }
      return [idx, idx, idx, 255];
    },
  };
}

// ------------------------------------------------------------ escritor PNG
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Escreve um PNG RGBA a partir de uma função pixel(x, y) -> [r,g,b,a]. */
function writePng(width, height, pixelAt) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 4);
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixelAt(x, y);
      row[1 + x * 4] = r;
      row[2 + x * 4] = g;
      row[3 + x * 4] = b;
      row[4 + x * 4] = a;
    }
    rows.push(row);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Escala por vizinho mais próximo (mantém o pixel nítido). */
function upscale(image, size) {
  return (x, y) => {
    const sx = Math.floor((x / size) * image.w);
    const sy = Math.floor((y / size) * image.h);
    return image.pixel(Math.min(sx, image.w - 1), Math.min(sy, image.h - 1));
  };
}

// ------------------------------------------------------------------ ícones
if (!existsSync(SRC)) {
  console.error("textura não encontrada:", SRC);
  process.exit(1);
}
const image = readPng(SRC);
mkdirSync(OUT_DIR, { recursive: true });

const sizes = [32, 128, 256];
const files = {};
for (const size of sizes) {
  const png = writePng(size, size, upscale(image, size));
  files[size] = png;
}

writeFileSync(join(OUT_DIR, "32x32.png"), files[32]);
writeFileSync(join(OUT_DIR, "128x128.png"), files[128]);
writeFileSync(join(OUT_DIR, "128x128@2x.png"), files[256]);

// .ico com um único PNG de 256x256 (formato suportado pelo Windows/Linux)
{
  const entry = files[256];
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  const dir = Buffer.alloc(16);
  dir[0] = 0; // largura 256
  dir[1] = 0; // altura 256
  dir[2] = 0; // sem paleta
  dir[3] = 0;
  dir.writeUInt16LE(1, 4);
  dir.writeUInt16LE(32, 6);
  dir.writeUInt32BE(entry.length, 8);
  dir.writeUInt32BE(22, 12);
  writeFileSync(join(OUT_DIR, "icon.ico"), Buffer.concat([header, dir, entry]));
}

// .icns com a entrada ic07 (128x128 PNG)
{
  const entry = files[128];
  const total = 8 + entry.length;
  const magic = Buffer.from("icns", "ascii");
  const sizeBuf = Buffer.alloc(4);
  sizeBuf.writeUInt32BE(total);
  const type = Buffer.from("ic07", "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(entry.length + 8);
  writeFileSync(join(OUT_DIR, "icon.icns"), Buffer.concat([magic, sizeBuf, type, len, entry]));
}

console.log("ícones gerados em", OUT_DIR);
