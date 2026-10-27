import { createCanvas } from "@napi-rs/canvas";
import { AttachmentBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { canvasFonts } from "./canvas.js";
import { friendshipTier } from "./friendship.js";
import { actionRow, card } from "./ui.js";

export interface FriendshipBoardRow { userA: string; userB: string; xp: number }

/** Fixed columns and generous row spacing keep long names separate from XP. */
export function renderFriendshipBoard(rows: FriendshipBoardRow[], names: Map<string, string>, page: number, total: number): Buffer {
  const start = (page - 1) * 7;
  const visible = rows.slice(start, start + 7);
  const canvas = createCanvas(1040, 300 + visible.length * 112);
  const ctx = canvas.getContext("2d");
  const fonts = canvasFonts();
  ctx.fillStyle = "#13121b"; ctx.fillRect(0, 0, canvas.width, canvas.height);
  const glow = ctx.createLinearGradient(0, 0, 1040, 260);
  glow.addColorStop(0, "#39283e"); glow.addColorStop(1, "#1c1a31");
  ctx.fillStyle = glow; ctx.fillRect(0, 0, 1040, 238);
  const label = (value: string, x: number, y: number, size: number, color: string, bold = false) => {
    ctx.font = `${size}px ${bold ? fonts.bold : fonts.regular}`;
    ctx.fillStyle = color; ctx.fillText(value, x, y);
  };
  label("SIELA  /  THE FRIENDSHIP CLUB", 48, 52, 18, "#e7a0c3", true);
  label("Better together.", 48, 117, 48, "#fff5fb", true);
  label("The duos making this server feel like home.", 48, 156, 22, "#bcb2c6");
  label(`${total} DUOS`, 48, 208, 17, "#e7a0c3", true);
  ctx.textAlign = "right";
  label(`PAGE ${page} / ${Math.max(1, Math.ceil(total / 7))}`, 992, 208, 17, "#bcb2c6");
  ctx.textAlign = "left";
  const shorten = (value: string, max: number) => {
    let result = value;
    while (ctx.measureText(result).width > max && result.length > 1) result = [...result].slice(0, -2).join("") + "…";
    return result;
  };
  visible.forEach((row, i) => {
    const rank = start + i + 1, y = 254 + i * 112;
    const accent = rank === 1 ? "#edcc85" : rank === 2 ? "#c6c8e1" : rank === 3 ? "#dca78c" : "#938ba5";
    ctx.fillStyle = rank <= 3 ? "#24212e" : "#1b1924";
    ctx.beginPath(); ctx.roundRect(32, y, 976, 100, 14); ctx.fill();
    ctx.fillStyle = accent; ctx.beginPath(); ctx.roundRect(32, y + 22, 3, 56, 2); ctx.fill();
    label(String(rank).padStart(2, "0"), 54, y + 59, 26, accent, true);
    ctx.font = `24px ${fonts.bold}`;
    const first = shorten(names.get(row.userA) ?? "Unavailable user", 600);
    const second = shorten(names.get(row.userB) ?? "Unavailable user", 600);
    label(first, 120, y + 34, 24, "#f6f0fa", true);
    label(`& ${second}`, 120, y + 64, 22, "#c9bfd3");
    label(friendshipTier(row.xp).label.toUpperCase(), 120, y + 86, 12, accent, true);
    ctx.textAlign = "right";
    label(row.xp.toLocaleString("en-US"), 970, y + 47, 32, rank <= 3 ? accent : "#eee6f5", true);
    label("PAIR XP", 970, y + 72, 12, "#938ba5", true);
    ctx.textAlign = "left";
  });
  label("Every shared moment counts.", 48, canvas.height - 18, 16, "#938ba5");
  return canvas.toBuffer("image/png");
}

export function friendshipBoardPayload(rows: FriendshipBoardRow[], names: Map<string, string>, page: number, disabled = false) {
  const totalPages = Math.max(1, Math.ceil(rows.length / 7));
  const safePage = Math.max(1, Math.min(totalPages, page));
  const rowsOfControls = totalPages > 1 ? [actionRow(
    new ButtonBuilder().setCustomId(`lb:page:${safePage - 1}`).setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(disabled || safePage === 1),
    new ButtonBuilder().setCustomId(`lb:page:${safePage + 1}`).setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(disabled || safePage === totalPages),
  )] : [];
  const description = rows.slice((safePage - 1) * 7, safePage * 7).map((row, index) =>
    `${(safePage - 1) * 7 + index + 1}. ${names.get(row.userA) ?? "Unavailable user"} & ${names.get(row.userB) ?? "Unavailable user"}: ${row.xp} XP`
  ).join("; ").slice(0, 1024);
  return {
    ...card({ theme: "social", eyebrow: "THE FRIENDSHIP CLUB", image: { name: "friendship-board.png", description }, rows: rowsOfControls, footer: false }),
    files: [new AttachmentBuilder(renderFriendshipBoard(rows, names, safePage, rows.length), { name: "friendship-board.png" })],
    attachments: [],
  };
}
