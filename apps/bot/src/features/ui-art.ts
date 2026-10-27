import { createCanvas } from "@napi-rs/canvas";
import { canvasFonts } from "./canvas.js";

/** Locally rendered artwork: no remote image service or member data requests. */
const cache = new Map<string, Buffer>();

export function renderCardHero(input: { title: string; kicker: string; color: number }): Buffer {
  const title = input.title.slice(0, 90);
  const kicker = input.kicker.slice(0, 60);
  const key = `${input.color}:${title}:${kicker}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = createCanvas(1100, 280);
  const ctx = canvas.getContext("2d");
  const fonts = canvasFonts();
  const hex = `#${input.color.toString(16).padStart(6, "0")}`;
  ctx.fillStyle = "#101019";
  ctx.fillRect(0, 0, 1100, 280);
  const glow = ctx.createRadialGradient(910, 135, 5, 910, 135, 520);
  glow.addColorStop(0, `${hex}99`);
  glow.addColorStop(0.48, `${hex}35`);
  glow.addColorStop(1, `${hex}00`);
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 1100, 280);
  for (let i = 0; i < 4; i += 1) {
    ctx.beginPath();
    ctx.ellipse(930, 130, 95 + i * 53, 95 + i * 53, -0.35, 0, Math.PI * 2);
    ctx.strokeStyle = `${hex}${i % 2 ? "22" : "50"}`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  const star = (x: number, y: number, radius: number, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(Math.PI / 7);
    ctx.beginPath();
    ctx.moveTo(0, -radius);
    ctx.quadraticCurveTo(radius * 0.2, -radius * 0.2, radius, 0);
    ctx.quadraticCurveTo(radius * 0.2, radius * 0.2, 0, radius);
    ctx.quadraticCurveTo(-radius * 0.2, radius * 0.2, -radius, 0);
    ctx.quadraticCurveTo(-radius * 0.2, -radius * 0.2, 0, -radius);
    ctx.fillStyle = "#eee4ff";
    ctx.fill();
    ctx.restore();
  };
  star(930, 135, 75, 0.95);
  star(805, 63, 15, 0.7);
  star(1032, 218, 24, 0.8);
  star(1040, 48, 7, 0.6);
  for (let i = 0; i < 28; i += 1) {
    ctx.fillStyle = `rgba(232,220,255,${0.12 + (i % 4) * 0.1})`;
    ctx.beginPath();
    ctx.arc(650 + ((i * 83) % 440), 15 + ((i * 59) % 250), i % 3 === 0 ? 1.8 : 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.font = `bold 16px "${fonts.bold}"`;
  ctx.fillStyle = "#d1b9ed";
  ctx.fillText(`S I E L A   /   ${kicker.toUpperCase()}`, 46, 53);
  let size = 55;
  ctx.font = `bold ${size}px "${fonts.bold}"`;
  while (ctx.measureText(title).width > 745 && size > 24) {
    size -= 1;
    ctx.font = `bold ${size}px "${fonts.bold}"`;
  }
  ctx.fillStyle = "#faf5ff";
  ctx.fillText(title, 44, 145, 745);
  ctx.font = `19px "${fonts.regular}"`;
  ctx.fillStyle = "#b8a8c7";
  ctx.fillText("A little magic. A little main-character energy.", 47, 191);
  ctx.fillStyle = `${hex}88`;
  ctx.fillRect(46, 230, 54, 3);
  ctx.fillStyle = "#62516f";
  ctx.font = `12px "${fonts.regular}"`;
  ctx.fillText("MADE FOR YOUR LITTLE CORNER OF THE INTERNET", 116, 236);
  const buffer = canvas.toBuffer("image/png");
  if (cache.size >= 24) cache.delete(cache.keys().next().value!);
  cache.set(key, buffer);
  return buffer;
}
