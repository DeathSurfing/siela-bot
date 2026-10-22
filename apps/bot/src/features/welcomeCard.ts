import { createCanvas, loadImage } from "@napi-rs/canvas";
import { canvasFont } from "./canvas.js";

export interface WelcomeCardInput {
  displayName: string;
  username: string;
  avatarUrl: string;
  serverName: string;
  memberCount: number;
  message: string;
}

function clean(value: string, max: number): string {
  const text = value
    .replace(/<@[!&]?\d+>/g, "")
    .replace(/<#\d+>/g, "")
    .replace(/[*_`~|>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function generateWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  const fontFamily = canvasFont();
  const width = 900;
  const height = 280;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#1e1b4b");
  gradient.addColorStop(1, "#4c1d95");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.globalAlpha = 0.12;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(width - 80, -40, 220, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  const avatarSize = 150;
  const avatarX = 55;
  const avatarY = (height - avatarSize) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  try {
    const response = await fetch(input.avatarUrl, { signal: AbortSignal.timeout(4_000) });
    if (response.ok) {
      const image = await loadImage(Buffer.from(await response.arrayBuffer()));
      ctx.drawImage(image, avatarX, avatarY, avatarSize, avatarSize);
    } else {
      throw new Error("avatar fetch failed");
    }
  } catch {
    ctx.fillStyle = "#312e81";
    ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
  }
  ctx.restore();

  ctx.lineWidth = 5;
  ctx.strokeStyle = "#a78bfa";
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + avatarSize + 45;
  ctx.fillStyle = "#f8fafc";
  ctx.font = `bold 44px ${fontFamily}`;
  ctx.fillText(clean(input.displayName, 24), textX, 105);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = `24px ${fontFamily}`;
  ctx.fillText(`@${clean(input.username, 30)}`, textX, 145);

  ctx.fillStyle = "#e2e8f0";
  ctx.font = `26px ${fontFamily}`;
  ctx.fillText(clean(input.message, 52), textX, 195);

  ctx.fillStyle = "#a5b4fc";
  ctx.font = `22px ${fontFamily}`;
  ctx.fillText(`${clean(input.serverName, 34)} • member #${input.memberCount}`, textX, 240);

  return Buffer.from(canvas.toBuffer("image/png"));
}
