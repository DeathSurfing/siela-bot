import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { RELIC_RARITIES } from "@siela/shared";
import type { RelicFoil, RelicRarity, RelicSigil, RelicStats } from "@siela/shared";
import { canvasFonts } from "../canvas.js";

const WIDTH = 720;
const HEIGHT = 1008;
const TAU = Math.PI * 2;

const CARD_X = 18;
const CARD_Y = 18;
const CARD_W = WIDTH - CARD_X * 2;
const CARD_H = HEIGHT - CARD_Y * 2;

const INK = "#05060d";
const TEXT = "#f8fafc";
const MUTED = "rgba(226, 232, 240, 0.62)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface Fonts {
  regular: string;
  bold: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface RelicArtInput {
  serial: number;
  name: string;
  variantName: string;
  rarity: RelicRarity;
  sigil: RelicSigil;
  category: string;
  lore: string;
  stats: RelicStats;
  palette: readonly [string, string, string];
  foil: RelicFoil;
  mintedAt: Date | null;
  ownerName?: string | null;
  isGenesis?: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function parseHex(value: string): Rgb {
  const hex = value.trim().replace(/^#/, "");
  if (/^[0-9a-f]{3}$/i.test(hex)) {
    return {
      r: Number.parseInt(`${hex[0]}${hex[0]}`, 16),
      g: Number.parseInt(`${hex[1]}${hex[1]}`, 16),
      b: Number.parseInt(`${hex[2]}${hex[2]}`, 16),
    };
  }
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
    };
  }
  return { r: 32, g: 36, b: 56 };
}

function channel(value: number): string {
  return Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
}

function rgba(color: string, alpha: number): string {
  const { r, g, b } = parseHex(color);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${clamp(alpha, 0, 1)})`;
}

function mix(a: string, b: string, amount: number): string {
  const first = parseHex(a);
  const second = parseHex(b);
  const t = clamp(amount, 0, 1);
  return `#${channel(first.r + (second.r - first.r) * t)}${channel(first.g + (second.g - first.g) * t)}${channel(
    first.b + (second.b - first.b) * t,
  )}`;
}

function lighten(color: string, amount: number): string {
  return mix(color, "#ffffff", amount);
}

function darken(color: string, amount: number): string {
  return mix(color, INK, amount);
}

function createRng(seed: number): () => number {
  let state = (Math.imul(seed | 0, 0x9e3779b1) ^ 0x85ebca6b) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function roundedRectPath(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = clamp(radius, 0, Math.min(width, height) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function fontString(size: number, family: string, weight: "normal" | "bold"): string {
  return weight === "bold" ? `bold ${size}px ${family}` : `${size}px ${family}`;
}

function fitLine(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let value = text;
  while (value.length > 1 && ctx.measureText(`${value}…`).width > maxWidth) {
    value = value.slice(0, -1);
  }
  return `${value}…`;
}

function breakLongWord(ctx: SKRSContext2D, word: string, maxWidth: number): string[] {
  const pieces: string[] = [];
  let piece = "";
  for (const character of word) {
    if (piece && ctx.measureText(`${piece}${character}`).width > maxWidth) {
      pieces.push(piece);
      piece = character;
    } else {
      piece += character;
    }
  }
  if (piece) pieces.push(piece);
  return pieces.length ? pieces : [word];
}

function wrapAll(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (!words.length) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (ctx.measureText(word).width <= maxWidth) {
      current = word;
      continue;
    }
    const pieces = breakLongWord(ctx, word, maxWidth);
    const last = pieces.pop();
    lines.push(...pieces);
    current = last ?? "";
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const all = wrapAll(ctx, text, maxWidth);
  if (all.length <= maxLines) return all;
  const kept = all.slice(0, maxLines);
  kept[maxLines - 1] = fitLine(ctx, `${all.slice(maxLines - 1).join(" ")}…`, maxWidth);
  return kept;
}

function layoutTitle(
  ctx: SKRSContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
  family: string,
  baseSize: number,
  minSize: number,
): { lines: string[]; size: number } {
  let size = baseSize;
  while (size >= minSize) {
    ctx.font = fontString(size, family, "bold");
    const lines = wrapAll(ctx, text, maxWidth);
    if (lines.length <= maxLines) return { lines, size };
    size -= 2;
  }
  ctx.font = fontString(minSize, family, "bold");
  return { lines: wrapText(ctx, text, maxWidth, maxLines), size: minSize };
}

function spacedWidth(ctx: SKRSContext2D, text: string, spacing: number): number {
  let width = 0;
  for (const character of text) width += ctx.measureText(character).width + spacing;
  return Math.max(0, width - spacing);
}

function drawSpaced(
  ctx: SKRSContext2D,
  text: string,
  x: number,
  y: number,
  spacing: number,
  align: "left" | "center" | "right" = "left",
): void {
  const width = spacedWidth(ctx, text, spacing);
  let cursor = align === "center" ? x - width / 2 : align === "right" ? x - width : x;
  ctx.textAlign = "left";
  for (const character of text) {
    ctx.fillText(character, cursor, y);
    cursor += ctx.measureText(character).width + spacing;
  }
}

function polygon(ctx: SKRSContext2D, points: ReadonlyArray<readonly [number, number]>): void {
  const first = points[0];
  if (!first) return;
  ctx.beginPath();
  ctx.moveTo(first[0], first[1]);
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    if (point) ctx.lineTo(point[0], point[1]);
  }
  ctx.closePath();
}

function formatSerial(serial: number): string {
  return `#${String(Math.max(0, Math.round(serial))).padStart(4, "0")}`;
}

function formatMintDate(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return "UNMINTED";
  const day = String(value.getUTCDate()).padStart(2, "0");
  const month = MONTHS[value.getUTCMonth()] ?? "Jan";
  return `${day} ${month} ${value.getUTCFullYear()}`;
}

function normalize(value: string, fallback: string): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text || fallback;
}

function drawSprinkle(ctx: SKRSContext2D, x: number, y: number, size: number, color: string, alpha: number): void {
  ctx.save();
  ctx.fillStyle = rgba(color, alpha);
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.quadraticCurveTo(x, y, x + size, y);
  ctx.quadraticCurveTo(x, y, x, y + size);
  ctx.quadraticCurveTo(x, y, x - size, y);
  ctx.quadraticCurveTo(x, y, x, y - size);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Background                                                          */
/* ------------------------------------------------------------------ */

function drawBackground(
  ctx: SKRSContext2D,
  palette: readonly [string, string, string],
  rarityColor: string,
  rarityGlow: string,
  rng: () => number,
): void {
  const [first, second, third] = palette;

  ctx.save();
  roundedRectPath(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 30);
  ctx.clip();

  const base = ctx.createLinearGradient(0, 0, WIDTH, HEIGHT);
  base.addColorStop(0, darken(first, 0.76));
  base.addColorStop(0.42, darken(second, 0.82));
  base.addColorStop(0.75, darken(third, 0.78));
  base.addColorStop(1, "#04050a");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Layered radial glows keep the palette visible without hurting legibility.
  const glows: Array<{ x: number; y: number; radius: number; color: string; alpha: number }> = [
    { x: 120 + rng() * 120, y: 90 + rng() * 120, radius: 250 + rng() * 120, color: first, alpha: 0.34 },
    { x: 590 - rng() * 100, y: 770 + rng() * 140, radius: 260 + rng() * 110, color: third, alpha: 0.3 },
    { x: 380 + rng() * 80, y: 360 + rng() * 60, radius: 280, color: second, alpha: 0.38 },
    { x: 90 + rng() * 80, y: 880 + rng() * 60, radius: 220, color: second, alpha: 0.22 },
    { x: 640, y: 280, radius: 180 + rng() * 50, color: rarityColor, alpha: 0.1 },
  ];
  for (const glow of glows) {
    const gradient = ctx.createRadialGradient(glow.x, glow.y, 0, glow.x, glow.y, glow.radius);
    gradient.addColorStop(0, rgba(glow.color, glow.alpha));
    gradient.addColorStop(0.58, rgba(glow.color, glow.alpha * 0.35));
    gradient.addColorStop(1, rgba(glow.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  // Diagonal light rays.
  ctx.save();
  ctx.translate(WIDTH * 0.5, 400);
  ctx.rotate(-0.62);
  for (let index = 0; index < 10; index += 1) {
    const offset = -760 + index * 168 + rng() * 60;
    const thickness = 18 + rng() * 92;
    const color = index % 3 === 0 ? first : index % 3 === 1 ? second : third;
    ctx.fillStyle = rgba(color, 0.018 + rng() * 0.038);
    ctx.fillRect(-920, offset, 1840, thickness);
  }
  for (let index = 0; index < 3; index += 1) {
    ctx.fillStyle = rgba(lighten(rarityGlow, 0.2), 0.038);
    ctx.fillRect(-920, -420 + index * 370 + rng() * 120, 1840, 3 + rng() * 4);
  }
  ctx.restore();

  // Halftone dots, denser around the portrait.
  for (let y = 44; y < HEIGHT - 24; y += 25) {
    for (let x = 28; x < WIDTH - 12; x += 25) {
      const distance = Math.hypot(x - 360, y - 340);
      const alpha = 0.012 + Math.max(0, 1 - distance / 560) * 0.052 + rng() * 0.018;
      if (alpha < 0.026) continue;
      ctx.fillStyle = rgba(indexColor(indexFor(x, y), first, second, third), alpha);
      const radius = 0.7 + rng() * 1.2;
      ctx.beginPath();
      ctx.arc(x + (rng() - 0.5) * 7, y + (rng() - 0.5) * 7, radius, 0, TAU);
      ctx.fill();
    }
  }

  // Sparse star dust.
  for (let index = 0; index < 46; index += 1) {
    const x = 34 + rng() * (WIDTH - 68);
    const y = 42 + rng() * (HEIGHT - 84);
    const size = 0.6 + rng() * 1.5;
    ctx.fillStyle = rgba(index % 4 === 0 ? rarityGlow : "#ffffff", 0.08 + rng() * 0.24);
    ctx.beginPath();
    ctx.arc(x, y, size, 0, TAU);
    ctx.fill();
  }
  for (let index = 0; index < 8; index += 1) {
    drawSprinkle(
      ctx,
      50 + rng() * (WIDTH - 100),
      120 + rng() * (HEIGHT - 240),
      2.5 + rng() * 3.5,
      rarityGlow,
      0.16 + rng() * 0.22,
    );
  }

  // Grain: thousands of faint deterministic specks.
  for (let index = 0; index < 5200; index += 1) {
    const x = CARD_X + rng() * CARD_W;
    const y = CARD_Y + rng() * CARD_H;
    ctx.fillStyle = rng() > 0.52 ? `rgba(255, 255, 255, ${0.015 + rng() * 0.035})` : `rgba(0, 0, 0, ${0.02 + rng() * 0.05})`;
    ctx.fillRect(x, y, 1 + rng() * 1.4, 1 + rng() * 1.4);
  }

  // Vignette + darker top/bottom bands.
  const vignette = ctx.createRadialGradient(360, 470, 210, 360, 500, 720);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(0.68, "rgba(0, 0, 0, 0.14)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.66)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  const topShade = ctx.createLinearGradient(0, 0, 0, 180);
  topShade.addColorStop(0, "rgba(0, 0, 0, 0.5)");
  topShade.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = topShade;
  ctx.fillRect(0, 0, WIDTH, 180);

  const bottomShade = ctx.createLinearGradient(0, HEIGHT - 220, 0, HEIGHT);
  bottomShade.addColorStop(0, "rgba(0, 0, 0, 0)");
  bottomShade.addColorStop(1, "rgba(0, 0, 0, 0.52)");
  ctx.fillStyle = bottomShade;
  ctx.fillRect(0, HEIGHT - 220, WIDTH, 220);

  ctx.restore();
}

function indexFor(x: number, y: number): number {
  return (Math.floor(x / 25) + Math.floor(y / 25)) % 3;
}

function indexColor(index: number, first: string, second: string, third: string): string {
  if (index === 0) return first;
  if (index === 1) return second;
  return third;
}

/* ------------------------------------------------------------------ */
/* Foil finishes                                                       */
/* ------------------------------------------------------------------ */

function drawFoilWash(
  ctx: SKRSContext2D,
  foil: RelicFoil,
  rarityColor: string,
  rarityGlow: string,
  palette: readonly [string, string, string],
  rng: () => number,
): void {
  if (foil === "none") return;

  ctx.save();
  roundedRectPath(ctx, CARD_X, CARD_Y, CARD_W, CARD_H, 30);
  ctx.clip();

  if (foil === "holo") {
    ctx.save();
    ctx.translate(360, 500);
    ctx.rotate(-0.48);
    const band = ctx.createLinearGradient(-360, 0, 360, 0);
    band.addColorStop(0, rgba("#ff5ec4", 0));
    band.addColorStop(0.08, rgba("#ff5ec4", 0.16));
    band.addColorStop(0.24, rgba("#ffc46b", 0.22));
    band.addColorStop(0.4, rgba("#7bf1a8", 0.17));
    band.addColorStop(0.56, rgba("#62d9ff", 0.21));
    band.addColorStop(0.74, rgba("#9f8cff", 0.2));
    band.addColorStop(0.9, rgba("#ff9de2", 0.1));
    band.addColorStop(1, rgba("#ff9de2", 0));
    ctx.fillStyle = band;
    ctx.fillRect(-380, -760, 760, 1520);

    ctx.globalCompositeOperation = "screen";
    const shine = ctx.createLinearGradient(-160, 0, 240, 0);
    shine.addColorStop(0, "rgba(255, 255, 255, 0)");
    shine.addColorStop(0.45, "rgba(255, 255, 255, 0.09)");
    shine.addColorStop(0.55, "rgba(255, 255, 255, 0.16)");
    shine.addColorStop(0.7, "rgba(255, 255, 255, 0)");
    ctx.fillStyle = shine;
    ctx.fillRect(-260, -760, 520, 1520);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fillRect(-120, -760, 1.5, 1520);
    ctx.fillRect(96, -760, 1, 1520);
    ctx.restore();
  } else if (foil === "prism") {
    ctx.globalCompositeOperation = "screen";
    const bands: Array<{ color: string; offset: number; width: number; angle: number; alpha: number }> = [
      { color: "#ff6b6b", offset: -330, width: 92, angle: -0.64, alpha: 0.13 },
      { color: "#ffb347", offset: -190, width: 76, angle: -0.56, alpha: 0.12 },
      { color: "#ffe066", offset: -60, width: 64, angle: -0.5, alpha: 0.1 },
      { color: "#6ee7b7", offset: 58, width: 74, angle: -0.44, alpha: 0.12 },
      { color: "#60a5fa", offset: 200, width: 96, angle: -0.38, alpha: 0.13 },
      { color: "#c084fc", offset: 336, width: 84, angle: -0.32, alpha: 0.11 },
    ];
    for (const item of bands) {
      ctx.save();
      ctx.translate(360, 500);
      ctx.rotate(item.angle);
      const gradient = ctx.createLinearGradient(item.offset, 0, item.offset + item.width, 0);
      gradient.addColorStop(0, rgba(item.color, 0));
      gradient.addColorStop(0.28, rgba(item.color, item.alpha));
      gradient.addColorStop(0.72, rgba(item.color, item.alpha * 0.85));
      gradient.addColorStop(1, rgba(item.color, 0));
      ctx.fillStyle = gradient;
      ctx.fillRect(item.offset, -820, item.width, 1640);
      ctx.fillStyle = rgba(lighten(item.color, 0.5), item.alpha * 0.5);
      ctx.fillRect(item.offset + item.width * 0.62, -820, 1.4, 1640);
      ctx.restore();
    }
    const flare = ctx.createRadialGradient(548, 182, 0, 548, 182, 210);
    flare.addColorStop(0, "rgba(255, 255, 255, 0.14)");
    flare.addColorStop(0.4, rgba("#c084fc", 0.07));
    flare.addColorStop(1, "rgba(192, 132, 252, 0)");
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (foil === "gold") {
    ctx.save();
    ctx.translate(360, 490);
    ctx.rotate(-0.36);
    const sheen = ctx.createLinearGradient(-420, 0, 420, 0);
    sheen.addColorStop(0, rgba("#f5cf7a", 0));
    sheen.addColorStop(0.2, rgba("#f5cf7a", 0.1));
    sheen.addColorStop(0.42, rgba("#fff0bc", 0.21));
    sheen.addColorStop(0.5, rgba("#ffe9a8", 0.26));
    sheen.addColorStop(0.62, rgba("#e3ab4b", 0.12));
    sheen.addColorStop(0.82, rgba("#f5cf7a", 0.06));
    sheen.addColorStop(1, rgba("#f5cf7a", 0));
    ctx.fillStyle = sheen;
    ctx.fillRect(-460, -820, 920, 1640);

    for (let index = 0; index < 34; index += 1) {
      ctx.fillStyle = `rgba(255, 240, 190, ${0.014 + rng() * 0.026})`;
      ctx.fillRect(-460 + rng() * 40, -820 + index * 48 + rng() * 18, 920, 0.8 + rng() * 1.2);
    }
    ctx.restore();

    const flare = ctx.createRadialGradient(560, 170, 0, 560, 170, 230);
    flare.addColorStop(0, rgba("#ffe7a8", 0.15));
    flare.addColorStop(0.45, rgba("#f5cf7a", 0.08));
    flare.addColorStop(1, rgba("#f5cf7a", 0));
    ctx.fillStyle = flare;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  } else if (foil === "obsidian") {
    for (let index = 0; index < 16; index += 1) {
      const side = Math.floor(rng() * 4);
      let originX = 0;
      let originY = 0;
      let directionX = 0;
      let directionY = 0;
      if (side === 0) {
        originX = rng() * WIDTH;
        originY = CARD_Y - 30;
        directionX = 0;
        directionY = 1;
      } else if (side === 1) {
        originX = WIDTH - CARD_X + 30;
        originY = rng() * HEIGHT;
        directionX = -1;
        directionY = 0;
      } else if (side === 2) {
        originX = rng() * WIDTH;
        originY = HEIGHT - CARD_Y + 30;
        directionX = 0;
        directionY = -1;
      } else {
        originX = CARD_X - 30;
        originY = rng() * HEIGHT;
        directionX = 1;
        directionY = 0;
      }
      const depth = 46 + rng() * 160;
      const spread = 24 + rng() * 72;
      const lean = (rng() - 0.5) * 80;
      const points: Array<readonly [number, number]> = [
        [originX - spread, originY],
        [originX + spread, originY],
        [
          originX + directionX * depth + directionY * lean + spread * 0.2,
          originY + directionY * depth + directionX * lean + spread * 0.2,
        ],
        [
          originX + directionX * depth * 0.55 - directionY * spread * 0.6,
          originY + directionY * depth * 0.55 - directionX * spread * 0.6,
        ],
      ];
      const gradient = ctx.createLinearGradient(
        originX,
        originY,
        originX + directionX * depth,
        originY + directionY * depth,
      );
      gradient.addColorStop(0, "rgba(3, 5, 12, 0.9)");
      gradient.addColorStop(0.6, "rgba(4, 7, 16, 0.7)");
      gradient.addColorStop(1, "rgba(10, 18, 34, 0.25)");
      polygon(ctx, points);
      ctx.fillStyle = gradient;
      ctx.fill();
      ctx.strokeStyle = rgba("#9bd8ff", 0.1 + rng() * 0.08);
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "screen";
    ctx.save();
    ctx.translate(360, 500);
    ctx.rotate(-0.5);
    for (let index = 0; index < 4; index += 1) {
      const gradient = ctx.createLinearGradient(-400 + index * 120, 0, 160 + index * 120, 0);
      gradient.addColorStop(0, "rgba(130, 205, 255, 0)");
      gradient.addColorStop(0.5, `rgba(150, 215, 255, ${0.05 + index * 0.012})`);
      gradient.addColorStop(1, "rgba(130, 205, 255, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(-500, -760, 900, 1520);
    }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";

    const cool = ctx.createRadialGradient(360, 340, 80, 360, 340, 380);
    cool.addColorStop(0, "rgba(120, 200, 255, 0)");
    cool.addColorStop(0.64, rgba(rarityGlow, 0.02));
    cool.addColorStop(1, rgba("#8fd3ff", 0.09));
    ctx.fillStyle = cool;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Sigils                                                              */
/* ------------------------------------------------------------------ */

function drawSigil(
  ctx: SKRSContext2D,
  sigil: RelicSigil,
  cx: number,
  cy: number,
  radius: number,
  rarityColor: string,
  rarityGlow: string,
  palette: readonly [string, string, string],
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(radius, radius);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const gradient = ctx.createLinearGradient(0, -1, 0, 1);
  gradient.addColorStop(0, lighten(rarityGlow, 0.62));
  gradient.addColorStop(0.48, rarityGlow);
  gradient.addColorStop(1, mix(rarityColor, palette[2], 0.42));
  const outline = rgba(INK, 0.68);

  const paint = (): void => {
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.lineWidth = 0.028;
    ctx.strokeStyle = outline;
    ctx.stroke();
  };

  ctx.shadowColor = rgba(rarityGlow, 0.55);
  ctx.shadowBlur = 26;

  if (sigil === "star") {
    const points: Array<readonly [number, number]> = [];
    for (let index = 0; index < 10; index += 1) {
      const pointRadius = index % 2 === 0 ? 0.92 : 0.4;
      const angle = -Math.PI / 2 + (index * Math.PI) / 5;
      points.push([Math.cos(angle) * pointRadius, Math.sin(angle) * pointRadius]);
    }
    polygon(ctx, points);
    paint();
    ctx.shadowBlur = 0;
    drawSprinkle(ctx, 0.48, -0.58, 0.1, "#ffffff", 0.8);
    drawSprinkle(ctx, -0.55, 0.38, 0.07, rarityGlow, 0.7);
  } else if (sigil === "bolt") {
    polygon(ctx, [
      [0.18, -0.96],
      [-0.5, 0.1],
      [-0.04, 0.1],
      [-0.18, 0.96],
      [0.52, -0.12],
      [0.06, -0.12],
    ]);
    paint();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = rgba("#ffffff", 0.45);
    ctx.beginPath();
    ctx.moveTo(-0.28, -0.42);
    ctx.lineTo(-0.08, 0.02);
    ctx.stroke();
  } else if (sigil === "heart") {
    ctx.beginPath();
    ctx.moveTo(0, 0.9);
    ctx.bezierCurveTo(-1.02, 0.16, -0.98, -0.68, -0.46, -0.76);
    ctx.bezierCurveTo(-0.16, -0.8, 0, -0.5, 0, -0.34);
    ctx.bezierCurveTo(0, -0.5, 0.16, -0.8, 0.46, -0.76);
    ctx.bezierCurveTo(0.98, -0.68, 1.02, 0.16, 0, 0.9);
    ctx.closePath();
    paint();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba("#ffffff", 0.35);
    ctx.lineWidth = 0.02;
    ctx.beginPath();
    ctx.moveTo(-0.58, -0.36);
    ctx.bezierCurveTo(-0.52, -0.63, -0.24, -0.7, -0.12, -0.56);
    ctx.stroke();
  } else if (sigil === "skull") {
    ctx.beginPath();
    ctx.moveTo(0, -0.92);
    ctx.bezierCurveTo(0.6, -0.92, 0.86, -0.55, 0.82, -0.14);
    ctx.bezierCurveTo(0.8, 0.12, 0.68, 0.24, 0.58, 0.3);
    ctx.lineTo(0.55, 0.64);
    ctx.quadraticCurveTo(0.55, 0.8, 0.38, 0.8);
    ctx.lineTo(-0.38, 0.8);
    ctx.quadraticCurveTo(-0.55, 0.8, -0.55, 0.64);
    ctx.lineTo(-0.58, 0.3);
    ctx.bezierCurveTo(-0.68, 0.24, -0.8, 0.12, -0.82, -0.14);
    ctx.bezierCurveTo(-0.86, -0.55, -0.6, -0.92, 0, -0.92);
    ctx.closePath();
    paint();
    ctx.shadowBlur = 0;
    for (const eyeX of [-0.3, 0.3]) {
      ctx.beginPath();
      ctx.ellipse(eyeX, -0.16, 0.18, 0.22, 0, 0, TAU);
      ctx.fillStyle = rgba(INK, 0.86);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeX + 0.04, -0.22, 0.045, 0, TAU);
      ctx.fillStyle = rgba(rarityGlow, 0.75);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.moveTo(0, 0.08);
    ctx.lineTo(0.1, 0.32);
    ctx.lineTo(-0.1, 0.32);
    ctx.closePath();
    ctx.fillStyle = rgba(INK, 0.82);
    ctx.fill();
    ctx.strokeStyle = rgba(INK, 0.65);
    ctx.lineWidth = 0.022;
    for (const toothX of [-0.24, 0, 0.24]) {
      ctx.beginPath();
      ctx.moveTo(toothX, 0.48);
      ctx.lineTo(toothX, 0.78);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(-0.35, 0.48);
    ctx.lineTo(0.35, 0.48);
    ctx.stroke();
  } else if (sigil === "crown") {
    polygon(ctx, [
      [-0.92, 0.4],
      [-0.99, -0.62],
      [-0.5, -0.06],
      [0, -0.82],
      [0.5, -0.06],
      [0.99, -0.62],
      [0.92, 0.4],
      [0.92, 0.66],
      [-0.92, 0.66],
    ]);
    paint();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = rgba(INK, 0.45);
    ctx.lineWidth = 0.025;
    ctx.beginPath();
    ctx.moveTo(-0.92, 0.4);
    ctx.lineTo(0.92, 0.4);
    ctx.stroke();
    for (const jewel of [
      [-0.92, -0.62],
      [0, -0.82],
      [0.92, -0.62],
      [-0.38, 0.53],
      [0.38, 0.53],
    ] as const) {
      ctx.beginPath();
      ctx.arc(jewel[0], jewel[1], 0.075, 0, TAU);
      ctx.fillStyle = rgba("#ffffff", 0.82);
      ctx.fill();
    }
  } else if (sigil === "ghost") {
    ctx.beginPath();
    ctx.moveTo(-0.62, 0.9);
    ctx.lineTo(-0.62, 0.02);
    ctx.bezierCurveTo(-0.62, -0.78, 0.62, -0.78, 0.62, 0.02);
    ctx.lineTo(0.62, 0.9);
    ctx.bezierCurveTo(0.46, 0.72, 0.34, 1.02, 0.18, 0.84);
    ctx.bezierCurveTo(0.06, 0.7, -0.04, 1.02, -0.16, 0.84);
    ctx.bezierCurveTo(-0.3, 0.68, -0.42, 1.02, -0.62, 0.78);
    ctx.closePath();
    paint();
    ctx.shadowBlur = 0;
    for (const eyeX of [-0.22, 0.22]) {
      ctx.beginPath();
      ctx.ellipse(eyeX, -0.14, 0.095, 0.15, 0, 0, TAU);
      ctx.fillStyle = rgba(INK, 0.86);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(eyeX + 0.025, -0.2, 0.03, 0, TAU);
      ctx.fillStyle = rgba("#ffffff", 0.65);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 0.24, 0.11, 0.15, 0, 0, TAU);
    ctx.fillStyle = rgba(INK, 0.75);
    ctx.fill();
  } else if (sigil === "flame") {
    ctx.beginPath();
    ctx.moveTo(0.03, -0.96);
    ctx.bezierCurveTo(0.18, -0.6, 0.6, -0.42, 0.6, 0.16);
    ctx.bezierCurveTo(0.6, 0.66, 0.3, 0.96, 0, 0.96);
    ctx.bezierCurveTo(-0.34, 0.96, -0.64, 0.66, -0.64, 0.14);
    ctx.bezierCurveTo(-0.64, -0.2, -0.4, -0.36, -0.3, -0.62);
    ctx.bezierCurveTo(-0.24, -0.4, -0.14, -0.28, -0.04, -0.22);
    ctx.bezierCurveTo(-0.1, -0.5, -0.02, -0.74, 0.03, -0.96);
    ctx.closePath();
    paint();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(0, -0.14);
    ctx.bezierCurveTo(0.1, -0.02, 0.3, 0.08, 0.3, 0.32);
    ctx.bezierCurveTo(0.3, 0.6, 0.15, 0.76, 0, 0.76);
    ctx.bezierCurveTo(-0.15, 0.76, -0.3, 0.6, -0.3, 0.32);
    ctx.bezierCurveTo(-0.3, 0.1, -0.14, 0.02, 0, -0.14);
    ctx.closePath();
    ctx.fillStyle = rgba("#ffffff", 0.55);
    ctx.fill();
  } else if (sigil === "spiral") {
    ctx.beginPath();
    const steps = 190;
    for (let index = 0; index <= steps; index += 1) {
      const progress = index / steps;
      const angle = progress * TAU * 3.35;
      const pointRadius = 0.08 + progress * 0.84;
      const x = Math.cos(angle) * pointRadius;
      const y = Math.sin(angle) * pointRadius;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.lineWidth = 0.095;
    ctx.strokeStyle = gradient;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, 0.1, 0, TAU);
    ctx.fillStyle = gradient;
    ctx.fill();
    const endAngle = TAU * 3.35;
    ctx.beginPath();
    ctx.arc(Math.cos(endAngle) * 0.92, Math.sin(endAngle) * 0.92, 0.075, 0, TAU);
    ctx.fillStyle = rgba("#ffffff", 0.8);
    ctx.fill();
  } else if (sigil === "eye") {
    ctx.beginPath();
    ctx.moveTo(-0.96, 0);
    ctx.quadraticCurveTo(-0.44, -0.64, 0, -0.64);
    ctx.quadraticCurveTo(0.44, -0.64, 0.96, 0);
    ctx.quadraticCurveTo(0.44, 0.64, 0, 0.64);
    ctx.quadraticCurveTo(-0.44, 0.64, -0.96, 0);
    ctx.closePath();
    paint();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(0, 0, 0.34, 0, TAU);
    ctx.fillStyle = rgba(INK, 0.78);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 0.34, 0, TAU);
    ctx.lineWidth = 0.035;
    ctx.strokeStyle = rgba(rarityGlow, 0.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 0.13, 0, TAU);
    ctx.fillStyle = rgba(INK, 0.96);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-0.1, -0.1, 0.055, 0, TAU);
    ctx.fillStyle = rgba("#ffffff", 0.9);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0.12, 0.12, 0.03, 0, TAU);
    ctx.fillStyle = rgba("#ffffff", 0.55);
    ctx.fill();
    ctx.lineWidth = 0.022;
    ctx.strokeStyle = rgba("#ffffff", 0.4);
    for (const lash of [-0.5, -0.18, 0.18, 0.5] as const) {
      ctx.beginPath();
      ctx.moveTo(lash, -0.48 + Math.abs(lash) * 0.32);
      ctx.lineTo(lash * 1.16, -0.62 + Math.abs(lash) * 0.32);
      ctx.stroke();
    }
  } else {
    polygon(ctx, [
      [0, -0.96],
      [0.5, -0.5],
      [0.64, 0.2],
      [0.24, 0.9],
      [-0.32, 0.96],
      [-0.58, 0.3],
      [-0.62, -0.28],
      [-0.28, -0.72],
    ]);
    paint();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 0.024;
    ctx.strokeStyle = rgba("#ffffff", 0.38);
    ctx.beginPath();
    ctx.moveTo(0, -0.96);
    ctx.lineTo(0.08, 0.08);
    ctx.lineTo(0.24, 0.9);
    ctx.moveTo(0.5, -0.5);
    ctx.lineTo(0.08, 0.08);
    ctx.lineTo(-0.58, 0.3);
    ctx.moveTo(-0.28, -0.72);
    ctx.lineTo(0.08, 0.08);
    ctx.stroke();
  }

  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* Portrait well                                                       */
/* ------------------------------------------------------------------ */

function drawPortraitWell(
  ctx: SKRSContext2D,
  input: RelicArtInput,
  fonts: Fonts,
  palette: readonly [string, string, string],
  rarityColor: string,
  rarityGlow: string,
): void {
  const cx = WIDTH / 2;
  const cy = 346;

  const halo = ctx.createRadialGradient(cx, cy, 70, cx, cy, 240);
  halo.addColorStop(0, rgba(rarityGlow, 0.26));
  halo.addColorStop(0.5, rgba(rarityColor, 0.12));
  halo.addColorStop(1, rgba(rarityColor, 0));
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(cx, cy, 240, 0, TAU);
  ctx.fill();

  ctx.save();
  ctx.shadowColor = rgba(rarityColor, 0.5);
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(cx, cy, 160, 0, TAU);
  ctx.fillStyle = rgba("#070911", 0.55);
  ctx.fill();
  ctx.restore();

  // Gem well.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, 134, 0, TAU);
  ctx.clip();
  const well = ctx.createRadialGradient(cx - 24, cy - 34, 8, cx, cy, 140);
  well.addColorStop(0, rgba(lighten(palette[1], 0.1), 0.88));
  well.addColorStop(0.38, darken(palette[1], 0.48));
  well.addColorStop(0.78, darken(palette[0], 0.72));
  well.addColorStop(1, "#03040a");
  ctx.fillStyle = well;
  ctx.fillRect(cx - 140, cy - 140, 280, 280);

  for (let index = 0; index < 5; index += 1) {
    const x = cx - 70 + index * 34;
    const y = cy + 80 - index * 26;
    const haze = ctx.createRadialGradient(x, y, 0, x, y, 70);
    haze.addColorStop(0, rgba(index % 2 === 0 ? palette[2] : rarityGlow, 0.1));
    haze.addColorStop(1, rgba(palette[2], 0));
    ctx.fillStyle = haze;
    ctx.fillRect(cx - 140, cy - 140, 280, 280);
  }

  // Fine concentric etching inside the well.
  ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
  ctx.lineWidth = 0.8;
  for (const radius of [40, 62, 90, 118]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  // Ticks and rings.
  for (let index = 0; index < 72; index += 1) {
    const angle = (index / 72) * TAU;
    const long = index % 6 === 0;
    const inner = 143;
    const outer = long ? 154 : 148;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * inner, cy + Math.sin(angle) * inner);
    ctx.lineTo(cx + Math.cos(angle) * outer, cy + Math.sin(angle) * outer);
    ctx.lineWidth = long ? 1.4 : 0.7;
    ctx.strokeStyle = long ? rgba(rarityGlow, 0.6) : rgba("#ffffff", 0.14);
    ctx.stroke();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, 137, 0, TAU);
  ctx.lineWidth = 1.1;
  ctx.strokeStyle = rgba(rarityColor, 0.85);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 160, 0, TAU);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = rgba(rarityGlow, 0.34);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, 166, 0, TAU);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.09)";
  ctx.stroke();

  for (const direction of [
    [0, -1],
    [1, 0],
    [0, 1],
    [-1, 0],
  ] as const) {
    const x = cx + direction[0] * 160;
    const y = cy + direction[1] * 160;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(Math.atan2(direction[1], direction[0]));
    ctx.fillStyle = rgba(rarityGlow, 0.9);
    ctx.beginPath();
    ctx.moveTo(4, 0);
    ctx.lineTo(0, 3.2);
    ctx.lineTo(-4, 0);
    ctx.lineTo(0, -3.2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  drawSigil(ctx, input.sigil, cx, cy, 92, rarityColor, rarityGlow, palette);

  for (let index = 0; index < 5; index += 1) {
    const angle = -1.9 + index * 0.86;
    drawSprinkle(
      ctx,
      cx + Math.cos(angle) * 116,
      cy + Math.sin(angle) * 116 * 0.82,
      2.2 + (index % 2) * 1.2,
      rarityGlow,
      0.32,
    );
  }

  ctx.font = fontString(10, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.64)";
  drawSpaced(ctx, normalize(input.category, "relic").toUpperCase(), cx, 524, 3.2, "center");

  ctx.strokeStyle = rgba(rarityGlow, 0.22);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(212, 520);
  ctx.lineTo(288, 520);
  ctx.moveTo(432, 520);
  ctx.lineTo(508, 520);
  ctx.stroke();

  ctx.fillStyle = rgba(rarityGlow, 0.5);
  for (const x of [298, 422]) {
    ctx.beginPath();
    ctx.moveTo(x, 516);
    ctx.lineTo(x + 4, 520);
    ctx.lineTo(x, 524);
    ctx.lineTo(x - 4, 520);
    ctx.closePath();
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Text blocks                                                         */
/* ------------------------------------------------------------------ */

function drawPlate(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  accent: string,
): void {
  roundedRectPath(ctx, x, y, width, height, radius);
  const fill = ctx.createLinearGradient(x, y, x, y + height);
  fill.addColorStop(0, "rgba(6, 8, 16, 0.58)");
  fill.addColorStop(1, "rgba(6, 8, 16, 0.78)");
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(accent, 0.16);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(x + radius, y + 0.5);
  ctx.lineTo(x + width - radius, y + 0.5);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.06)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawTitleBlock(
  ctx: SKRSContext2D,
  input: RelicArtInput,
  fonts: Fonts,
  rarityColor: string,
  rarityGlow: string,
  rarityLabel: string,
): void {
  const centerX = WIDTH / 2;
  const plateX = 44;
  const plateY = 542;
  const plateWidth = WIDTH - plateX * 2;
  const plateHeight = 208;
  drawPlate(ctx, plateX, plateY, plateWidth, plateHeight, 20, rarityColor);

  const name = normalize(input.name, "Unnamed Relic");
  const layout = layoutTitle(ctx, name, 544, 2, fonts.bold, 44, 28);
  const lineHeight = Math.round(layout.size * 1.04);
  const firstBaseline = 596 - ((layout.lines.length - 1) * lineHeight) / 2;

  const nameFill = ctx.createLinearGradient(0, 556, 0, 640);
  nameFill.addColorStop(0, "#ffffff");
  nameFill.addColorStop(1, "#d7deea");
  ctx.fillStyle = nameFill;
  ctx.font = fontString(layout.size, fonts.bold, "bold");
  ctx.textAlign = "center";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 2;
  layout.lines.forEach((line, index) => {
    ctx.fillText(line, centerX, firstBaseline + index * lineHeight);
  });
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.textAlign = "left";

  // Variant + rarity pill.
  let pillSize = 12;
  const variant = normalize(input.variantName, "Standard").toUpperCase();
  const rarityText = rarityLabel.toUpperCase();
  const separator = "  ·  ";
  let variantText = variant;
  const measurePill = (): { variantWidth: number; separatorWidth: number; rarityWidth: number } => {
    ctx.font = fontString(pillSize, fonts.bold, "bold");
    return {
      variantWidth: ctx.measureText(variantText).width,
      separatorWidth: ctx.measureText(separator).width,
      rarityWidth: ctx.measureText(rarityText).width,
    };
  };
  let widths = measurePill();
  while (pillSize > 9 && widths.variantWidth + widths.separatorWidth + widths.rarityWidth > 512) {
    pillSize -= 1;
    widths = measurePill();
  }
  while (
    variantText.length > 1 &&
    widths.variantWidth + widths.separatorWidth + widths.rarityWidth > 512
  ) {
    variantText = variantText.slice(0, -1);
    widths = measurePill();
  }
  if (variantText !== variant) variantText = `${variantText.trimEnd()}…`;

  const textWidth = widths.variantWidth + widths.separatorWidth + widths.rarityWidth;
  const pillHeight = 30;
  const pillWidth = Math.min(600, textWidth + 62);
  const pillX = centerX - pillWidth / 2;
  const pillY = 632;

  roundedRectPath(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  const pillFill = ctx.createLinearGradient(pillX, pillY, pillX, pillY + pillHeight);
  pillFill.addColorStop(0, rgba(darken(rarityColor, 0.55), 0.72));
  pillFill.addColorStop(1, rgba(darken(rarityColor, 0.78), 0.84));
  ctx.fillStyle = pillFill;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(rarityColor, 0.62);
  ctx.stroke();

  const pillCenterY = pillY + pillHeight / 2 + 1;
  ctx.textBaseline = "middle";
  ctx.beginPath();
  ctx.arc(pillX + 19, pillCenterY, 3.3, 0, TAU);
  ctx.fillStyle = rgba(rarityGlow, 0.95);
  ctx.fill();

  ctx.textAlign = "left";
  let cursor = pillX + 32;
  ctx.font = fontString(pillSize, fonts.bold, "bold");
  ctx.fillStyle = "rgba(248, 250, 252, 0.94)";
  ctx.fillText(variantText, cursor, pillCenterY);
  cursor += widths.variantWidth;
  ctx.fillStyle = "rgba(255, 255, 255, 0.34)";
  ctx.fillText(separator, cursor, pillCenterY);
  cursor += widths.separatorWidth;
  ctx.fillStyle = rgba(rarityGlow, 0.96);
  ctx.fillText(rarityText, cursor, pillCenterY);
  ctx.textBaseline = "alphabetic";

  const lore = normalize(input.lore, "A relic with a story yet to be told.");
  ctx.font = fontString(16, fonts.regular, "normal");
  const loreLines = wrapText(ctx, lore, 548, 3);
  ctx.fillStyle = MUTED;
  ctx.textAlign = "center";
  loreLines.forEach((line, index) => {
    ctx.fillText(line, centerX, 688 + index * 21);
  });
  ctx.textAlign = "left";
}

function drawStats(
  ctx: SKRSContext2D,
  stats: RelicStats,
  fonts: Fonts,
  rarityColor: string,
  rarityGlow: string,
): void {
  const plateX = 44;
  const plateY = 762;
  const plateWidth = WIDTH - plateX * 2;
  const plateHeight = 128;
  drawPlate(ctx, plateX, plateY, plateWidth, plateHeight, 20, rarityColor);

  ctx.font = fontString(9, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  drawSpaced(ctx, "ATTRIBUTES", 68, 786, 2.4, "left");
  drawSpaced(ctx, "RATING", 596, 786, 2.4, "center");

  const rows: Array<{ label: string; value: number }> = [
    { label: "POWER", value: stats.power },
    { label: "CHAOS", value: stats.chaos },
    { label: "LUCK", value: stats.luck },
    { label: "AURA", value: stats.aura },
  ];
  const barX = 170;
  const barWidth = 296;
  const barHeight = 5;
  const valueX = 488;

  rows.forEach((row, index) => {
    const baseline = 810 + index * 24;
    const value = clamp(Math.round(row.value), 0, 99);

    ctx.font = fontString(10, fonts.bold, "bold");
    ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
    drawSpaced(ctx, row.label, 68, baseline, 2.1, "left");

    roundedRectPath(ctx, barX, baseline - 8, barWidth, barHeight, barHeight / 2);
    ctx.fillStyle = "rgba(255, 255, 255, 0.12)";
    ctx.fill();

    const fillWidth = Math.max(value > 0 ? 7 : 0, (value / 99) * barWidth);
    if (fillWidth > 0) {
      roundedRectPath(ctx, barX, baseline - 8, fillWidth, barHeight, barHeight / 2);
      const fill = ctx.createLinearGradient(barX, 0, barX + barWidth, 0);
      fill.addColorStop(0, rgba(rarityColor, 0.95));
      fill.addColorStop(1, rgba(rarityGlow, 0.95));
      ctx.fillStyle = fill;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(barX + fillWidth, baseline - 8 + barHeight / 2, 3, 0, TAU);
      ctx.fillStyle = rgba(rarityGlow, 0.9);
      ctx.fill();
    }

    ctx.font = fontString(14, fonts.bold, "bold");
    ctx.fillStyle = "rgba(248, 250, 252, 0.92)";
    ctx.textAlign = "right";
    ctx.fillText(String(value), valueX, baseline);
    ctx.textAlign = "left";
  });

  ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(516, 780);
  ctx.lineTo(516, 878);
  ctx.stroke();

  const rating = clamp(Math.round(stats.rating), 0, 999);
  ctx.textAlign = "center";
  ctx.font = fontString(46, fonts.bold, "bold");
  const ratingFill = ctx.createLinearGradient(0, 798, 0, 866);
  ratingFill.addColorStop(0, "#ffffff");
  ratingFill.addColorStop(1, rarityGlow);
  ctx.fillStyle = ratingFill;
  ctx.shadowColor = rgba(rarityColor, 0.45);
  ctx.shadowBlur = 16;
  ctx.fillText(String(rating), 596, 845);
  ctx.shadowBlur = 0;
  ctx.shadowColor = "rgba(0, 0, 0, 0)";
  ctx.font = fontString(10, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  drawSpaced(ctx, "/ 100", 596, 866, 1.4, "center");
  ctx.textAlign = "left";
}

function drawFooter(
  ctx: SKRSContext2D,
  input: RelicArtInput,
  fonts: Fonts,
  rarityColor: string,
  rarityGlow: string,
): void {
  const x = 44;
  const y = 906;
  const width = WIDTH - x * 2;
  const height = 58;
  drawPlate(ctx, x, y, width, height, 16, rarityColor);

  const serial = formatSerial(input.serial);
  ctx.font = fontString(23, fonts.bold, "bold");
  ctx.fillStyle = "rgba(248, 250, 252, 0.96)";
  ctx.fillText(serial, 68, 936);
  const serialWidth = ctx.measureText(serial).width;

  if (input.isGenesis) {
    const badgeX = 68 + serialWidth + 12;
    const badgeY = 919;
    const badgeWidth = 78;
    const badgeHeight = 21;
    roundedRectPath(ctx, badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
    const badgeFill = ctx.createLinearGradient(badgeX, badgeY, badgeX + badgeWidth, badgeY + badgeHeight);
    badgeFill.addColorStop(0, "rgba(247, 212, 137, 0.22)");
    badgeFill.addColorStop(1, "rgba(247, 212, 137, 0.08)");
    ctx.fillStyle = badgeFill;
    ctx.fill();
    ctx.strokeStyle = "rgba(247, 212, 137, 0.62)";
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.font = fontString(8, fonts.bold, "bold");
    ctx.fillStyle = "#f7d489";
    drawSpaced(ctx, "GENESIS", badgeX + badgeWidth / 2, badgeY + 14, 1.4, "center");
  }

  const dateText = input.mintedAt ? `MINTED ${formatMintDate(input.mintedAt)}` : "UNMINTED";
  ctx.font = fontString(10, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.48)";
  drawSpaced(ctx, dateText, 652, 934, 1.4, "right");

  const owner = input.ownerName ? normalize(input.ownerName, "") : "";
  if (owner) {
    ctx.font = fontString(9, fonts.bold, "bold");
    const prefix = "OWNED BY ";
    const prefixWidth = spacedWidth(ctx, prefix, 1.5);
    ctx.font = fontString(9, fonts.bold, "bold");
    const maxNameWidth = 500 - prefixWidth;
    const nameText = fitLine(ctx, owner.toUpperCase(), maxNameWidth);
    const nameWidth = spacedWidth(ctx, nameText, 1.5);
    const totalWidth = prefixWidth + nameWidth;
    const startX = WIDTH / 2 - totalWidth / 2;
    ctx.fillStyle = "rgba(255, 255, 255, 0.32)";
    drawSpaced(ctx, prefix, startX, 956, 1.5, "left");
    ctx.fillStyle = rgba(rarityGlow, 0.78);
    drawSpaced(ctx, nameText, startX + prefixWidth, 956, 1.5, "left");
  } else {
    ctx.font = fontString(8, fonts.bold, "bold");
    ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
    drawSpaced(ctx, "SIELA RELICS", WIDTH / 2, 956, 3.4, "center");
  }
}

/* ------------------------------------------------------------------ */
/* Frame + banner                                                      */
/* ------------------------------------------------------------------ */

function drawCornerFlourish(ctx: SKRSContext2D, color: string, gold: boolean): void {
  ctx.save();
  ctx.strokeStyle = rgba(color, 0.78);
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(0, 40);
  ctx.quadraticCurveTo(0, 0, 40, 0);
  ctx.stroke();

  ctx.strokeStyle = rgba(color, 0.36);
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(0, 60);
  ctx.bezierCurveTo(12, 18, 18, 12, 60, 0);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(7, 24);
  ctx.quadraticCurveTo(9, 9, 24, 7);
  ctx.stroke();

  ctx.fillStyle = rgba(gold ? "#ffe7a8" : color, 0.9);
  ctx.beginPath();
  ctx.moveTo(12, 12);
  ctx.lineTo(17, 17);
  ctx.lineTo(12, 22);
  ctx.lineTo(7, 17);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(31, 4, 1.5, 0, TAU);
  ctx.arc(4, 31, 1.5, 0, TAU);
  ctx.fillStyle = rgba(color, 0.6);
  ctx.fill();
  ctx.restore();
}

function drawFrame(
  ctx: SKRSContext2D,
  foil: RelicFoil,
  rarityColor: string,
  rarityGlow: string,
): void {
  const gold = foil === "gold";

  roundedRectPath(ctx, CARD_X + 0.5, CARD_Y + 0.5, CARD_W - 1, CARD_H - 1, 30);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = rgba(rarityColor, 0.5);
  ctx.shadowBlur = 20;
  roundedRectPath(ctx, CARD_X + 1.5, CARD_Y + 1.5, CARD_W - 3, CARD_H - 3, 30);
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = rgba(rarityColor, 0.95);
  ctx.stroke();
  ctx.restore();

  roundedRectPath(ctx, 27.5, 27.5, WIDTH - 55, HEIGHT - 55, 24);
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(rarityGlow, 0.5);
  ctx.stroke();

  if (gold) {
    roundedRectPath(ctx, 23, 23, WIDTH - 46, HEIGHT - 46, 27);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = "rgba(247, 212, 137, 0.7)";
    ctx.stroke();
  }

  roundedRectPath(ctx, 36.5, 36.5, WIDTH - 73, HEIGHT - 73, 20);
  ctx.lineWidth = 0.7;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.13)";
  ctx.stroke();

  const accent = gold ? "#ffe7a8" : rarityGlow;
  const corners: Array<{ x: number; y: number; sx: number; sy: number }> = [
    { x: 44, y: 44, sx: 1, sy: 1 },
    { x: WIDTH - 44, y: 44, sx: -1, sy: 1 },
    { x: 44, y: HEIGHT - 44, sx: 1, sy: -1 },
    { x: WIDTH - 44, y: HEIGHT - 44, sx: -1, sy: -1 },
  ];
  for (const corner of corners) {
    ctx.save();
    ctx.translate(corner.x, corner.y);
    ctx.scale(corner.sx, corner.sy);
    drawCornerFlourish(ctx, accent, gold);
    ctx.restore();
  }
}

function drawBanner(
  ctx: SKRSContext2D,
  fonts: Fonts,
  rarityColor: string,
  rarityGlow: string,
): void {
  ctx.font = fontString(10, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.62)";
  drawSpaced(ctx, "SIELA RELICS", 68, 70, 3.4, "left");

  ctx.fillStyle = rgba(rarityGlow, 0.85);
  ctx.beginPath();
  ctx.moveTo(57, 63);
  ctx.lineTo(61, 67);
  ctx.lineTo(57, 71);
  ctx.lineTo(53, 67);
  ctx.closePath();
  ctx.fill();

  const pillWidth = 82;
  const pillHeight = 24;
  const pillX = 652 - pillWidth;
  const pillY = 52;
  roundedRectPath(ctx, pillX, pillY, pillWidth, pillHeight, pillHeight / 2);
  ctx.fillStyle = "rgba(4, 6, 12, 0.45)";
  ctx.fill();
  ctx.strokeStyle = rgba(rarityColor, 0.4);
  ctx.lineWidth = 0.9;
  ctx.stroke();

  ctx.font = fontString(8.5, fonts.bold, "bold");
  ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
  drawSpaced(ctx, "1 OF 1", pillX + pillWidth / 2, pillY + 16, 2.1, "center");

  const divider = ctx.createLinearGradient(68, 0, 652, 0);
  divider.addColorStop(0, "rgba(255, 255, 255, 0)");
  divider.addColorStop(0.18, "rgba(255, 255, 255, 0.14)");
  divider.addColorStop(0.5, rgba(rarityGlow, 0.32));
  divider.addColorStop(0.82, "rgba(255, 255, 255, 0.14)");
  divider.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.strokeStyle = divider;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(68, 88);
  ctx.lineTo(652, 88);
  ctx.stroke();

  ctx.fillStyle = rgba(rarityGlow, 0.6);
  ctx.beginPath();
  ctx.moveTo(360, 84);
  ctx.lineTo(364, 88);
  ctx.lineTo(360, 92);
  ctx.lineTo(356, 88);
  ctx.closePath();
  ctx.fill();
}

/* ------------------------------------------------------------------ */
/* Card                                                                */
/* ------------------------------------------------------------------ */

export async function renderRelicCard(input: RelicArtInput): Promise<Buffer> {
  const fonts = canvasFonts();
  const rng = createRng(input.serial);
  const rarity = RELIC_RARITIES[input.rarity] ?? RELIC_RARITIES.common;
  const rarityColor = rarity.color;
  const rarityGlow = rarity.glow;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  drawBackground(ctx, input.palette, rarityColor, rarityGlow, rng);
  drawFoilWash(ctx, input.foil, rarityColor, rarityGlow, input.palette, rng);

  drawBanner(ctx, fonts, rarityColor, rarityGlow);
  drawPortraitWell(ctx, input, fonts, input.palette, rarityColor, rarityGlow);
  drawTitleBlock(ctx, input, fonts, rarityColor, rarityGlow, rarity.label);
  drawStats(ctx, input.stats, fonts, rarityColor, rarityGlow);
  drawFooter(ctx, input, fonts, rarityColor, rarityGlow);
  drawFrame(ctx, input.foil, rarityColor, rarityGlow);

  return Buffer.from(canvas.toBuffer("image/png"));
}
