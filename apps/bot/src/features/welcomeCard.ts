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

function drawStar(ctx: any, cx: number, cy: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r / 2.4;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawHeart(ctx: any, cx: number, cy: number, size: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy + size / 4);
  ctx.bezierCurveTo(cx, cy, cx - size / 2, cy, cx - size / 2, cy + size / 4);
  ctx.bezierCurveTo(cx - size / 2, cy + size / 2, cx, cy + size * 0.85, cx, cy + size);
  ctx.bezierCurveTo(cx, cy + size * 0.85, cx + size / 2, cy + size / 2, cx + size / 2, cy + size / 4);
  ctx.bezierCurveTo(cx + size / 2, cy, cx, cy, cx, cy + size / 4);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

export async function generateWelcomeCard(input: WelcomeCardInput): Promise<Buffer> {
  const fontFamily = canvasFont();
  const width = 900;
  const height = 280;
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext("2d");

  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#2a1052");
  gradient.addColorStop(0.5, "#4c1d95");
  gradient.addColorStop(1, "#6d28d9");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // soft glow blobs
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "#c084fc";
  ctx.beginPath();
  ctx.arc(120, 40, 160, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(width - 60, height - 20, 180, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // decorative stars
  drawStar(ctx, 60, 40, 12, "#f0abfc");
  drawStar(ctx, 840, 50, 10, "#fbbf24");
  drawStar(ctx, 800, 240, 9, "#a5f3fc");
  drawStar(ctx, 150, 250, 8, "#f9a8d4");

  // decorative hearts (BTS purple heart motif)
  drawHeart(ctx, 760, 30, 22, "rgba(192,132,252,0.55)");
  drawHeart(ctx, 820, 110, 16, "rgba(244,114,182,0.45)");
  drawHeart(ctx, 70, 230, 14, "rgba(167,139,250,0.45)");

  // lightstick silhouette (army bomb) - simple stick + glowing orb
  function drawLightstick(x: number, y: number, scale: number): void {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    // handle
    ctx.fillStyle = "#e2e8f0";
    ctx.fillRect(-4, 0, 8, 40);
    // orb
    const orb = ctx.createRadialGradient(0, -6, 2, 0, -6, 16);
    orb.addColorStop(0, "#ffffff");
    orb.addColorStop(0.4, "#c084fc");
    orb.addColorStop(1, "rgba(192,132,252,0)");
    ctx.fillStyle = orb;
    ctx.beginPath();
    ctx.arc(0, -6, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  drawLightstick(860, 180, 1.4);
  drawLightstick(30, 90, 1.1);

  // ARMY watermark
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 96px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.fillText("ARMY", width / 2 + 60, height / 2 + 30);
  ctx.textAlign = "left";
  ctx.globalAlpha = 1;

  const avatarSize = 180;
  const avatarX = 45;
  const avatarY = (height - avatarSize) / 2;

  // glow ring
  ctx.save();
  const glow = ctx.createRadialGradient(
    avatarX + avatarSize / 2,
    avatarY + avatarSize / 2,
    avatarSize / 2 - 6,
    avatarX + avatarSize / 2,
    avatarY + avatarSize / 2,
    avatarSize / 2 + 18,
  );
  glow.addColorStop(0, "rgba(192,132,252,0.0)");
  glow.addColorStop(1, "rgba(192,132,252,0.6)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // avatar circle clip
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
    ctx.fillStyle = "#c4b5fd";
    ctx.font = `bold ${Math.floor(avatarSize / 2)}px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((input.displayName || "?").charAt(0).toUpperCase(), avatarX + avatarSize / 2, avatarY + avatarSize / 2);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }
  ctx.restore();

  // ring stroke
  ctx.lineWidth = 6;
  ctx.strokeStyle = "#c084fc";
  ctx.beginPath();
  ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
  ctx.stroke();

  const textX = avatarX + avatarSize + 40;
  ctx.fillStyle = "#f8fafc";
  ctx.font = `bold 40px ${fontFamily}`;
  ctx.fillText(clean(input.displayName, 22), textX, 95);

  ctx.fillStyle = "#e9d5ff";
  ctx.font = `22px ${fontFamily}`;
  ctx.fillText(`@${clean(input.username, 28)}`, textX, 130);

  ctx.fillStyle = "#f3e8ff";
  ctx.font = `20px ${fontFamily}`;
  ctx.fillText(clean(input.message, 60), textX, 175);

  ctx.fillStyle = "#c4b5fd";
  ctx.font = `18px ${fontFamily}`;
  ctx.fillText(`${clean(input.serverName, 30)} • member #${input.memberCount}`, textX, 225);

  // BTS badge
  ctx.fillStyle = "rgba(192,132,252,0.25)";
  const badgeX = textX;
  const badgeY = 238;
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(badgeX, badgeY, 96, 26, 8);
  } else {
    ctx.rect(badgeX, badgeY, 96, 26);
  }
  ctx.fill();
  ctx.fillStyle = "#e9d5ff";
  ctx.font = `bold 13px ${fontFamily}`;
  ctx.fillText("💜 BTS ARMY", badgeX + 8, badgeY + 18);

  return Buffer.from(canvas.toBuffer("image/png"));
}