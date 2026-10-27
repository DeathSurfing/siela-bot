import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { AttachmentBuilder } from "discord.js";
import { canvasFonts } from "./canvas.js";
import { card } from "./ui.js";

export interface SlotsResult { reels: string[]; wager: number; payout: number }
const SYMBOL_NAMES: Record<string, string> = { "🍒": "Cherries", "🍋": "Lemon", "🔔": "Bell", "⭐": "Star", "7️⃣": "Seven" };

function symbol(ctx: SKRSContext2D, value: string, x: number, y: number) {
  ctx.save(); ctx.translate(x, y);
  if (value === "🍒") {
    ctx.strokeStyle = "#427b52"; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-25, 20); ctx.quadraticCurveTo(-16, -35, 16, -45); ctx.quadraticCurveTo(38, -15, 25, 25); ctx.stroke();
    ctx.fillStyle = "#69a26b"; ctx.beginPath(); ctx.ellipse(31, -43, 23, 10, .4, 0, Math.PI * 2); ctx.fill();
    for (const [cx, cy] of [[-26, 24], [26, 33]]) {
      ctx.fillStyle = "#c73154"; ctx.beginPath(); ctx.arc(cx!, cy!, 27, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ff8094"; ctx.beginPath(); ctx.arc(cx! - 8, cy! - 9, 6, 0, Math.PI * 2); ctx.fill();
    }
  } else if (value === "🍋") {
    ctx.fillStyle = "#edc24f"; ctx.beginPath(); ctx.ellipse(0, 5, 53, 36, -.55, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#ffed9c"; ctx.lineWidth = 4; ctx.beginPath(); ctx.ellipse(-4, 0, 37, 24, -.55, Math.PI, Math.PI * 1.65); ctx.stroke();
    ctx.fillStyle = "#76a66c"; ctx.beginPath(); ctx.ellipse(34, -34, 20, 9, -.2, 0, Math.PI * 2); ctx.fill();
  } else if (value === "🔔") {
    ctx.fillStyle = "#d3a04b"; ctx.beginPath(); ctx.arc(0, 37, 12, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f3c86b"; ctx.beginPath(); ctx.moveTo(-43, 29); ctx.quadraticCurveTo(-28, 10, -30, -13); ctx.bezierCurveTo(-30, -61, 30, -61, 30, -13); ctx.quadraticCurveTo(28, 10, 43, 29); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#ffe6a8"; ctx.beginPath(); ctx.roundRect(-45, 27, 90, 11, 5); ctx.fill();
  } else if (value === "⭐") {
    ctx.fillStyle = "#e9b94f"; ctx.beginPath();
    for (let i = 0; i < 10; i++) { const angle = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 24 : 57; const px = Math.cos(angle) * r, py = Math.sin(angle) * r; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); }
    ctx.closePath(); ctx.fill();
  } else {
    ctx.font = `94px ${canvasFonts().bold}`; ctx.textAlign = "center"; ctx.fillStyle = "#b63858"; ctx.fillText("7", 0, 38);
  }
  ctx.restore();
}

export function renderSlotsResult(result: SlotsResult): Buffer {
  const c = createCanvas(1040, 740), ctx = c.getContext("2d"), fonts = canvasFonts();
  const win = result.payout > 0;
  const bg = ctx.createLinearGradient(0, 0, 1040, 740); bg.addColorStop(0, "#302339"); bg.addColorStop(1, "#161923");
  ctx.fillStyle = bg; ctx.fillRect(0, 0, 1040, 740);
  const text = (value: string, x: number, y: number, size: number, color: string, bold = false) => { ctx.fillStyle = color; ctx.font = `${size}px ${bold ? fonts.bold : fonts.regular}`; ctx.fillText(value, x, y); };
  text("SIELA  /  THE LUCKY ROOM", 52, 57, 17, "#dcbf83", true);
  text("A little luck.", 52, 119, 46, "#fff4e5", true);
  text("Three reels. One result.", 52, 156, 20, "#b8adbf");
  ctx.strokeStyle = "#d7b77c"; ctx.lineWidth = 2; ctx.fillStyle = "#11131c";
  ctx.beginPath(); ctx.roundRect(43, 201, 954, 278, 26); ctx.fill(); ctx.stroke();
  for (let i = 0; i < 3; i++) {
    const x = 74 + i * 302;
    const reel = ctx.createLinearGradient(0, 225, 0, 454); reel.addColorStop(0, "#e0d6c7"); reel.addColorStop(.5, "#fffaed"); reel.addColorStop(1, "#d8cfbf");
    ctx.fillStyle = reel; ctx.beginPath(); ctx.roundRect(x, 225, 288, 228, 15); ctx.fill();
    symbol(ctx, result.reels[i] ?? "7️⃣", x + 144, 331);
    ctx.textAlign = "center"; text(SYMBOL_NAMES[result.reels[i]!] ?? "Seven", x + 144, 430, 15, "#776854", true); ctx.textAlign = "left";
  }
  // Small side markers point at the reel center without crossing the artwork.
  ctx.fillStyle = "#d7b77c";
  for (const [x, direction] of [[48, 1], [992, -1]]) { ctx.beginPath(); ctx.moveTo(x!, 329); ctx.lineTo(x! + direction! * 15, 340); ctx.lineTo(x!, 351); ctx.fill(); }
  text("WAGER", 53, 524, 14, "#a99bb2", true); text(`${result.wager.toLocaleString("en-US")} SC`, 53, 559, 26, "#fff4e5", true);
  ctx.textAlign = "right"; text("PAYOUT", 987, 524, 14, "#a99bb2", true); text(`${result.payout.toLocaleString("en-US")} SC`, 987, 559, 26, win ? "#a5d3b4" : "#fff4e5", true); ctx.textAlign = "left";
  ctx.fillStyle = win ? "#233b32" : "#272330"; ctx.beginPath(); ctx.roundRect(43, 601, 954, 99, 16); ctx.fill();
  const triple = result.reels.every(value => value === result.reels[0]);
  text(win ? triple ? "Three of a kind!" : "A matching pair!" : "No match this time.", 67, 641, 27, win ? "#b9e4c7" : "#eee2ef", true);
  const net = result.payout - result.wager;
  text(`${net >= 0 ? "Net gain" : "Net loss"} · ${Math.abs(net).toLocaleString("en-US")} SC`, 67, 674, 18, "#baaec1");
  return c.toBuffer("image/png");
}

export function slotsPayload(result: SlotsResult) {
  const description = `${result.reels.map(value => SYMBOL_NAMES[value] ?? value).join(" · ")}. Wager ${result.wager} SC. Payout ${result.payout} SC. Net ${result.payout - result.wager} SC.`;
  return { ...card({ theme: "economy", eyebrow: "THE LUCKY ROOM", image: { name: "slots-result.png", description }, footer: false }), files: [new AttachmentBuilder(renderSlotsResult(result), { name: "slots-result.png" })] };
}
